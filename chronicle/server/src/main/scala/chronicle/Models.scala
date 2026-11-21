package chronicle
import chronicle.api.*
import cats.effect.{IO,Ref,Resource}
import cats.effect.std.Dispatcher
import cats.syntax.all.*
import org.http4s.{Request,Method,Uri,Header}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import io.circe.Json
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8
import scala.concurrent.duration.*
import ponygirls.retrieval.{JsonHttp,EmbeddingCodec,RetrievalError}

object Fragments {
  val maxBytes = 2048
  def split(messages: List[Message]): List[Chunk] = messages.flatMap { m =>
    val text = m.text; val result = List.newBuilder[Chunk]
    var charStart = 0; var byteStart = 0
    while(charStart < text.length) {
      var end = charStart; var bytes = 0
      while(end < text.length && bytes + new String(Character.toChars(text.codePointAt(end))).getBytes(UTF_8).length <= maxBytes) {
        val cp = text.codePointAt(end); bytes += new String(Character.toChars(cp)).getBytes(UTF_8).length; end += Character.charCount(cp)
      }
      result += Chunk(UUID.randomUUID(),new UUID(0,0),text.substring(charStart,end),"",Nil,List(Span(m.id,byteStart,byteStart+bytes)),0.0)
      byteStart += bytes; charStart=end
    }
    result.result()
  }
}
/** What one indexing job holds (ingest-limits spec §5.2.3, §5.2.7, §5.2.8): one window with its decision and one embedding
  * part at a time (accepted work is checkpointed, not retained), the carry between windows, and while publishing one
  * statement batch. `maxIndexingBudgetBytes` bounds one window, not the job: a window whose pieces and Context coverage
  * spans would take more ends the job Failed with `exceededCode` before they are embedded, and so does a message whose
  * decode would take more, before it is fetched (StoredMessages). No job is refused for its whole size. */
object IndexingBudget {
  val exceededCode = "index-budget-exceeded"
  /** A piece's chunk: source slice (at most 4,096 B as UTF-16), summary (at most 4,000 B), tags (at most 4,096 B) and objects. */
  val chunkBytes = 13312
  /** One Context coverage span with its collection slot. */
  val coverageSpanBytes = 256
  /** One window's pieces with their vectors and its Context coverage spans. */
  def window(pieces: Long,spans: Long,dimensions: Int): BigInt =
    BigInt(pieces)*(BigInt(8L*dimensions)+BigInt(chunkBytes))+BigInt(spans)*BigInt(coverageSpanBytes)
  /** Heap per byte of a message's stored text while it is fetched and decoded (ingest-limits spec §5.2.8): the driver's row,
    * the decoded string (UTF-16), the JSON tree and the decoded Message. */
  val messageDecodeFactor = 7
}
trait Embedder { def documents(owner: String,text: List[String]): IO[List[List[Double]]]; def query(owner: String,text: String): IO[List[Double]] }
object ModelHttp {
  def client(config: Config): Resource[IO,Client[IO]] =
    JsonHttp.client(transportTimeout(config))
  def transportTimeout(config: Config): FiniteDuration = config.annotation.timeoutSeconds.max(config.embedding.timeoutSeconds).seconds
}
final class ModelHttp(client: Client[IO],telemetry: ModelTelemetry,admission: ModelAdmission) {
  def post(context: ModelCallContext,endpoint: String,credentialFile: String,timeout: Int,maxBytes: Int,payload: Json): IO[Json] =
    postDecoded(context,endpoint,credentialFile,timeout,maxBytes,payload)(identity)
  def postDecoded[A](context: ModelCallContext,endpoint: String,credentialFile: String,timeout: Int,maxBytes: Int,payload: Json)(decode: Json => A): IO[A] = IO.defer {
    admission.request(context.purpose).use { _ => Ref.of[IO,ProviderUsage](ProviderUsage.unknown).flatMap { usage =>
      Resource.makeCase(telemetry.begin(context)) { (ticket,exit) =>
        val outcome=exit match {
          case Resource.ExitCase.Succeeded => ModelCallOutcome.Complete
          case Resource.ExitCase.Errored(_) => ModelCallOutcome.Failed
          case Resource.ExitCase.Canceled => ModelCallOutcome.Cancelled
        }
        usage.get.flatMap(value => telemetry.finish(ticket,outcome,value))
      }.use { _ =>
        JsonHttp.credential(credentialFile).flatMap { credential =>
          JsonHttp.postF(client,endpoint,credential,timeout.seconds,maxBytes,payload) { json => usage.set(ProviderUsage.parse(json,context.purpose)).as(json).map(decode) }
        }
          .handleErrorWith {
            case error: RetrievalError => error.code match {
              case "model-response-bound" => IO.raiseError(ModelRejection.from(ModelRejectionReason.ResponseByteBound))
              case "model-json" => IO.raiseError(ModelRejection.from(ModelRejectionReason.ModelJsonInvalid))
              case _ => IO.raiseError(DomainError(error.code,error.detail))
            }
            case error => IO.raiseError(error)
          }
      }
    }}
  }
}
object ModelOutput {
  def parse(text: String): Json = io.circe.parser.parse(text).fold(_ => throw ModelRejection.from(ModelRejectionReason.ModelJsonInvalid),identity)
}
enum AnnotationRequestPolicy(val identity: String,val responseTokens: Int) {
  case StrictJsonSchema extends AnnotationRequestPolicy("strict-json-schema:responseTokens2048",2048)
  case GlmMaxReasoning extends AnnotationRequestPolicy("glm-max-reasoning:responseTokens65536",65536)
}
final class OpenAIEmbedder(http: ModelHttp,config: Config) extends Embedder {
  def documents(owner: String,text: List[String]): IO[List[List[Double]]] = embed(ModelCallContext(owner,ModelWorkload.IndexEmbedding),text.map(config.embedding.documentPrefix+_))
  def query(owner: String,text: String): IO[List[Double]] = embed(ModelCallContext(owner,ModelWorkload.QueryEmbedding),List(config.embedding.queryPrefix+text)).map(_.head)
  private def embed(context: ModelCallContext,text: List[String]): IO[List[List[Double]]] = {
    val cfg = config.embedding
    Check(text.forall(_.getBytes(UTF_8).length <= 16384),"invalid","embedding input bound including prefix")
    Check(text.nonEmpty && text.size<=16,"invalid","embedding batch bound")
    val payload=EmbeddingCodec.payload(cfg.model,text,cfg.dimensions,cfg.sendDimensions)
    http.post(context,cfg.endpoint,cfg.credentialFile,cfg.timeoutSeconds,cfg.maxResponseBytes,payload).map { json =>
      try EmbeddingCodec.decode(json,text.size,cfg.dimensions)
      catch { case error: RetrievalError => throw DomainError(error.code,error.detail) }
    }
  }
}
final class Worker(archive: SessionArchive,problemAnnotator: ProblemPassageAnnotator,embedder: Embedder,config: Config,profiles: IndexProfileCatalog,admission: ModelAdmission,logger: logstage.IzLogger,failureBackoff: Worker.FailureBackoff,snapshots: SnapshotAdmission) {
  private val leaseSeconds = 300
  private val idleDelay = 1.second
  private final class AnnotationExhausted(val reason: String) extends RuntimeException(AnnotationAttempts.exhaustedCode) {
    def code: String = if(reason==AnnotationAttempts.callLimitReason) AnnotationAttempts.reservationExhaustedCode else AnnotationAttempts.exhaustedCode
  }
  private def failureCode(error: Throwable): String = error match { case exhausted: AnnotationExhausted => exhausted.code; case d: DomainError => d.code; case _ => "worker-fault" }
  private def failureOrigin(error: Throwable): String = error.getStackTrace.find(frame => !Set("chronicle.DomainError","chronicle.DomainError$","chronicle.Check","chronicle.Check$").contains(frame.getClassName)).map(frame => s"${frame.getClassName}.${frame.getMethodName}:${frame.getLineNumber}").getOrElse("unavailable")
  private final case class FailureDetails(reason: String,httpStatus: String,structure: Json)
  private def failureDetails(error: Throwable): FailureDetails = {
    val status=error match {
      case DomainError("model-http",s"model returned HTTP $value") if value.matches("(?:1|3|4|5)[0-9]{2}") => Some(value.toInt)
      case _ => None
    }
    val rejection=ModelRejection.classify(error)
    val reason=rejection.map(_.reason.value).getOrElse {
      if(status.nonEmpty) "http-status" else error match {
        case exhausted: AnnotationExhausted => exhausted.reason
        case DomainError("model-output","missing embedding data") => "embedding-data-decode"
        case DomainError("model-output","embedding count mismatch") => "embedding-count"
        case DomainError("model-output","missing embedding index") => "embedding-index-decode"
        case DomainError("model-output","invalid embedding") => "embedding-vector-decode"
        case DomainError("model-output","invalid vector dimension/value") => "embedding-vector-validation"
        case DomainError("model-output","invalid embedding indices") => "embedding-indices"
        case DomainError("model-timeout",_) => "model-deadline"
        case DomainError("model-output/truncated",_) => "annotation-token-limit"
        case DomainError("model-output",_) => "model-output-invalid"
        case DomainError("stale-claim",_) => "stale-claim"
        case _ => "unknown"
      }
    }
    FailureDetails(reason,status.fold("unavailable")(_.toString),rejection.map(_.safeDetails).getOrElse(Json.obj()))
  }
  private final case class StagedFailure(stage: IndexingStage,error: Throwable) extends RuntimeException
  private def publishStage(run: => IO[Unit]): IO[Unit] = IO.defer(run).handleErrorWith(error => IO.raiseError(StagedFailure(IndexingStage.Publication,error)))
  private final class Windows(claim: Claim,total: Int) {
    private val dimensions=config.embedding.dimensions
    def accepted[A](key: CheckpointKey)(decode: Json => A,encode: A => Json)(run: => IO[A]): IO[A] = IO.blocking(archive.checkpoint(claim,key)).flatMap {
      case Some(value) => IO(decode(value)).handleErrorWith(_ => IO.raiseError(DomainError("internal","invalid accepted checkpoint payload")))
      case None => IO.defer(run).flatTap(value => IO.blocking(archive.checkpoint(claim,key,encode(value))))
    }
    def report(completed: Int): IO[Unit] = IO.blocking {
      Check(archive.progress(claim,completed,total),"stale-claim","indexing claim is no longer current")
    }
    def failed(error: Throwable,index: Int,stage: String,attempt: Int): IO[Nothing] = {
      val failureStage=stage match {
        case "annotation" => IndexingStage.Annotation
        case "embedding" => IndexingStage.Embedding
        case _ => throw DomainError("internal","unknown indexing failure stage")
      }
      val code=failureCode(error)
      val exceptionClass=error.getClass.getName
      val origin=failureOrigin(error); val details=failureDetails(error); val reason=details.reason; val httpStatus=details.httpStatus; val structure=details.structure.noSpaces
      val annotationAttempt=if(attempt==0) "checkpoint" else attempt.toString
      IO(logger.warn(s"window failed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total stage=$stage annotationAttempt=$annotationAttempt annotationRejectionLimit=${AnnotationAttempts.rejectionLimit} code=$code exceptionClass=$exceptionClass origin=$origin reason=$reason httpStatus=$httpStatus structure=$structure")) *> IO.raiseError(StagedFailure(failureStage,error))
    }
    def annotate[A](key: CheckpointKey,run: => IO[A],index: Int): IO[(A,Int)] = IO.blocking(archive.reserveAnnotation(claim,key)).flatMap {
      case AnnotationReservation.Exhausted(reason,attempts) => failed(new AnnotationExhausted(reason),index,"annotation",attempts)
      case AnnotationReservation.Reserved(attempt) => IO.defer(run).map(value => (value,attempt)).handleErrorWith {
        case error: DomainError if Set("model-output","model-output/truncated").contains(error.code) =>
          val details=failureDetails(error); val reason=details.reason; val structure=details.structure.noSpaces; val code=error.code
          IO.blocking(archive.rejectAnnotation(claim,key,attempt,reason)).flatMap { rejected =>
            IO(logger.warn(s"annotation attempt failed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total attempt=$attempt rejected=$rejected rejectionLimit=${AnnotationAttempts.rejectionLimit} reservationLimit=${AnnotationAttempts.reservationLimit} code=$code reason=$reason structure=$structure")) *>
              (if(rejected==AnnotationAttempts.rejectionLimit) failed(new AnnotationExhausted(reason),index,"annotation",attempt)
              else IO.blocking(Check(archive.renew(claim,leaseSeconds),"stale-claim","indexing claim is no longer current")) *> annotate(key,run,index))
          }
        case error => failed(error,index,"annotation",attempt)
      }
    }.handleErrorWith {
      case staged: StagedFailure => IO.raiseError(staged)
      case error => failed(error,index,"annotation",0)
    }
    /** Embeds the window's pieces part by part, each part checkpointed and dropped (phase P reads the vectors back).
      * Before any is embedded, the window's pieces, their vectors and its Context spans must fit the budget. */
    def embed(delta: ProblemPassages.Delta,index: Int,attempt: Int): IO[Unit] = {
      val chunks=delta.pieces.map(_.chunk).toList
      val batchSize=config.indexing.embeddingBatchSize
      val batches=chunks.grouped(batchSize).toList
      val admitted=IO {
        val held=IndexingBudget.window(chunks.size,delta.context.size,dimensions)
        Check(held<=BigInt(config.maxIndexingBudgetBytes),IndexingBudget.exceededCode,s"indexing window would hold $held bytes, above the budget of ${config.maxIndexingBudgetBytes}")
      }
      val parts=batches.zipWithIndex.traverse_ { (batch,part) =>
        val key=IndexCheckpoints.key(claim,IndexingStage.Embedding,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,CheckpointJson.chunks(batch))
        def validated(vectors: List[List[Double]]): List[List[Double]] = { CheckpointJson.validateVectors(vectors,batch.size,dimensions); vectors }
        accepted(key)(json => validated(CheckpointJson.vectors(json)),CheckpointJson.vectors)(IO.defer(embedder.documents(claim.owner,batch.map(_.text))).map(validated))
      }
      // A part accepted under another batch size addresses other pieces: none of the window's parts is reused.
      (admitted *> parts.recoverWith { case _: CheckpointInputMismatch =>
        IO.blocking(archive.discardCheckpoints(claim,IndexingStage.Embedding,index)).flatMap { discarded =>
          val currentParts=batches.size
          IO(logger.warn(s"accepted work discarded jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total stage=embedding discardedParts=$discarded currentParts=$currentParts embeddingBatchSize=$batchSize"))
        } *> parts
      }).handleErrorWith(error => failed(error,index,"embedding",attempt))
    }
  }
  /** Phase P's rows (ingest-limits spec §5.2.4): the windows replayed from the job's accepted checkpoints (a missing one is
    * an internal fault: phase W accepted every one), validated window by window (ProblemRows.Validation). Each pass reads
    * the source once; nothing of a window is kept after it. */
  private final class Replay(claim: Claim,total: Int,fetch: MessageFetch) extends ProblemRows {
    private val dimensions=config.embedding.dimensions
    private def accepted(key: CheckpointKey): Json = archive.checkpoint(claim,key).getOrElse(throw DomainError("internal","accepted window result missing for the publication"))
    /** Every step from window 0: `window` for each window, then the finishing step's delta. */
    private def replay(window: (Int,ProblemPassages.Window,ProblemPassages.Delta) => Unit): ProblemPassages.Delta = {
      val source=ProblemPassages.Source(claim.messages.reader(fetch))
      var state=ProblemPassages.State.start(claim.sessionId,claim.runId)
      var index=0
      var next=source.next(state.nextSource)
      while(next.nonEmpty) {
        val value=next.get
        val input=Json.arr(value.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
        val decision=ProblemPassages.decode(value,state.carry.nonEmpty,accepted(IndexCheckpoints.key(claim,IndexingStage.Annotation,index,0,ProblemPassages.identity,input)))
        val delta=ProblemPassages.accept(state,value,decision)
        window(index,value,delta)
        state=delta.state; index+=1; next=source.next(state.nextSource)
      }
      Check(index==total,"internal","source window count changed")
      ProblemPassages.finish(state,source)
    }
    def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Counts = {
      val validation=new ProblemRows.Validation(claim.sessionId)
      val spans=new ProblemRows.Spans
      var context=0L
      def step(index: Int,delta: ProblemPassages.Delta,released: Vector[ProblemPassages.SpanUpdate],opened: Vector[ProblemPassages.Passage]): Unit = {
        val coverage=delta.context.zipWithIndex.map((span,i) => (context+i,span)); context+=delta.context.size
        if(index>=from) write(index,ProblemRows.Passages(opened,delta.passages.filter(_.closed).map(_.passage),released,coverage))
      }
      var seen=0
      val finished=replay { (index,window,delta) =>
        val released=spans.step(delta)
        validation.window(window,delta,released)
        val opened=delta.passages.filter(update => !update.closed && update.passage.ordinal>=seen).map(_.passage)
        seen=delta.state.nextPassageOrdinal
        step(index,delta,released,opened)
      }
      val released=spans.step(finished)
      val counts=validation.finish(total+1,finished,released)
      step(total,finished,released,Vector.empty)
      counts
    }
    def pieces(from: Int,passage: Int => ProblemRows.Final)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit = {
      replay { (index,_,delta) =>
        if(index>=from) {
          val chunks=delta.pieces.map(_.chunk).toList
          val vectors=chunks.grouped(config.indexing.embeddingBatchSize).zipWithIndex.flatMap { (batch,part) =>
            val key=IndexCheckpoints.key(claim,IndexingStage.Embedding,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,CheckpointJson.chunks(batch))
            val values=try CheckpointJson.vectors(accepted(key)) catch { case _: CheckpointInputMismatch => throw DomainError("internal","accepted embedding of another grouping for the publication") }
            CheckpointJson.validateVectors(values,batch.size,dimensions); values
          }.toVector
          val ordinals=delta.passages.map(update => update.passage.id->update.passage.ordinal).toMap
          write(index,delta.pieces.zip(vectors).map { (piece,vector) =>
            val ordinal=ordinals.getOrElse(piece.passageId,throw DomainError("internal","publication piece without its passage"))
            val value=passage(ordinal)
            Check(piece.ordinal<=Int.MaxValue,"internal","publication piece ordinal exceeds the chunk ordinal range")
            ProblemRows.Piece(ordinal,piece.ordinal.toInt,piece.chunk.copy(summary=value.summary,tags=value.tags),vector,piece.sourceSpan)
          })
        }
      }
      ()
    }
  }
  /** The count pass, through the reader the windows use: the source's windows. */
  private def count(claim: Claim,fetch: MessageFetch): Int = {
    val source=ProblemPassages.Source(claim.messages.reader(fetch))
    var cursor=ProblemPassages.SourceCursor.start
    var total=0
    var next=source.next(cursor)
    while(next.nonEmpty) {
      Check(total<Int.MaxValue,"internal","source window count overflow")
      total+=1; cursor=next.get.next; next=source.next(cursor)
    }
    total
  }
  private def passages(claim: Claim,large: LargeJobs,fetch: MessageFetch): IO[Unit] = IO.blocking(count(claim,fetch)).flatMap { total =>
    if(total>LargeJobs.windows && large==LargeJobs.Skipped)
      deferLarge(claim,total) *> IO(logger.info(s"large job deferred jobId=${claim.jobId} totalWindows=$total largeJobWindows=${LargeJobs.windows}"))
    else indexWindows(claim,ProblemPassages.Source(claim.messages.reader(fetch)),total) *> publish(claim,total,fetch)
  }
  /** Back to the queue with its window count and without the attempt: claims that skip large jobs pass it by. */
  private def deferLarge(claim: Claim,total: Int): IO[Unit] =
    IO.blocking(Check(archive.defer(claim,total),"stale-claim","indexing claim is no longer current"))
  /** Phase W (ingest-limits spec §5.2.3): each window's decision and embedding parts accepted (checkpointed) in order;
    * between windows only the passage state with its bounded carry is kept. */
  private def indexWindows(claim: Claim,source: ProblemPassages.Source,total: Int): IO[Unit] = {
    val windows=new Windows(claim,total)
    // A window reads its messages from the database.
    def loop(state: ProblemPassages.State,index: Int): IO[Unit] = IO.blocking(source.next(state.nextSource)).flatMap {
      case None => IO(Check(index==total,"internal","source window count changed"))
      case Some(window) =>
        val input=Json.arr(window.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
        val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,index,0,ProblemPassages.identity,input)
        val decision=windows.accepted(key)(json => (ProblemPassages.decode(window,state.carry.nonEmpty,json),0),value => CheckpointJson.decision(value._1))(
          windows.annotate(key,problemAnnotator.annotate(claim.owner,window,state.carry).flatTap(value => IO(ProblemPassages.validate(window,state.carry.nonEmpty,value))),index))
        decision.flatMap { (value,attempt) =>
          IO(ProblemPassages.accept(state,window,value)).handleErrorWith(_ => IO.raiseError(DomainError("internal","invalid accepted annotation state"))).flatMap { delta =>
            windows.embed(delta,index,attempt) *> windows.report(index+1) *> loop(delta.state,index+1)
          }
        }
    }
    windows.report(0) *> loop(ProblemPassages.State.start(claim.sessionId,claim.runId),0)
  }
  /** Phase P and the switch (ingest-limits spec §5.2.4), then the retirement of the replaced generation's search rows: the
    * job is Complete once switched, so a failed retirement is left to the maintenance pass. */
  private def publish(claim: Claim,total: Int,fetch: MessageFetch): IO[Unit] =
    publishStage(IO.blocking(Check(archive.publishProblems(claim,new Replay(claim,total,fetch)),"stale-claim","indexing claim is no longer current"))) *>
      IO.blocking(archive.retire(claim)).handleErrorWith { error =>
        val exceptionClass=error.getClass.getName; val sqlState=Worker.sqlState(error)
        IO(logger.warn(s"search row retirement left to maintenance jobId=${claim.jobId} exceptionClass=$exceptionClass sqlState=$sqlState"))
      }
  private def process(claim: Claim,large: LargeJobs): IO[Unit] = {
    val work=Dispatcher.sequential[IO](await=true).use(dispatcher => passages(claim,large,Worker.messageFetch(config,snapshots,dispatcher)))
    val renew=(IO.sleep(30.seconds) *> IO.blocking(Check(archive.renew(claim,leaseSeconds),"stale-claim","indexing claim is no longer current"))).foreverM
    IO.race(work,renew).void.handleErrorWith { failure =>
      val (stage,error)=failure match { case StagedFailure(stage,error) => (Some(stage),error); case error => (None,error) }
      error match {
        case error: DomainError if Worker.fatal(error) => IO.raiseError(error)
        case _ =>
          val code=failureCode(error)
          val exceptionClass=error.getClass.getName
          val origin=failureOrigin(error); val details=failureDetails(error); val reason=details.reason; val httpStatus=details.httpStatus
          val sqlState=Worker.sqlState(error)
          IO(logger.warn(s"job failed jobId=${claim.jobId} code=$code exceptionClass=$exceptionClass sqlState=$sqlState origin=$origin reason=$reason httpStatus=$httpStatus")) *> IO.blocking {
            stage match { case Some(value) => archive.fail(claim,code,value); case None => archive.fail(claim,code) }
          }.handleErrorWith {
            case fatal: DomainError if Worker.fatal(fatal) => IO.raiseError(fatal)
            case error => failureNotRecorded(claim,code,error)
          } *> IO.sleep(failureBackoff.delay)
      }
    }
  }
  /** The job keeps its lease: it is claimed again once the lease expires, or ends lease-exhausted. */
  private def failureNotRecorded(claim: Claim,failureCode: String,error: Throwable): IO[Unit] = {
    val code=this.failureCode(error); val exceptionClass=error.getClass.getName; val origin=failureOrigin(error); val sqlState=Worker.sqlState(error)
    IO(logger.warn(s"job failure not recorded jobId=${claim.jobId} failureCode=$failureCode code=$code exceptionClass=$exceptionClass sqlState=$sqlState origin=$origin"))
  }
  private def claimFailed(error: Throwable): IO[Worker.Iteration] = {
    val code=failureCode(error); val exceptionClass=error.getClass.getName; val origin=failureOrigin(error); val sqlState=Worker.sqlState(error)
    IO(logger.warn(s"job claim failed code=$code exceptionClass=$exceptionClass sqlState=$sqlState origin=$origin")).as(Worker.Iteration.ClaimFailed)
  }
  private def iteration: IO[Worker.Iteration] = admission.annotationSession.use { _ =>
    admission.largeJob.use { admitted =>
      val large=if(admitted) LargeJobs.Admitted else LargeJobs.Skipped
      // A claim decodes no message (ingest-limits spec §5.2.1): it waits for no snapshot admission.
      IO.blocking(archive.claim(profiles.knownProfiles,ClaimScope.AllOwners,leaseSeconds,large)).redeemWith(claimFailed,{
        case None => IO.pure(Worker.Iteration.Idle)
        case Some(claim) => process(claim,large).as(Worker.Iteration.Processed)
      })
    }
  }
  def once: IO[Boolean] = iteration.map(_==Worker.Iteration.Processed)
  def run: IO[Nothing] = {
    val retired=IO(config.maxSmallJobBudgetBytes.foreach(value => logger.warn(s"retired configuration key ignored key=maxSmallJobBudgetBytes value=$value: a job's heap is one window, bounded by maxIndexingBudgetBytes")))
    val lane: IO[Nothing]=iteration.flatMap {
      case Worker.Iteration.Processed => IO.unit
      case Worker.Iteration.Idle => IO.sleep(idleDelay)
      case Worker.Iteration.ClaimFailed => IO.sleep(failureBackoff.delay)
    }.foreverM
    retired *> List.fill(config.indexing.annotationSessions)(lane).parSequence.map(_.head)
  }
}
object Worker {
  private enum Iteration { case Processed,Idle,ClaimFailed }
  /** A job's message fetching (ingest-limits spec §5.2.2): within `maxIndexingBudgetBytes` per message, and a message above
    * SnapshotAdmission.largeBodyBytes under the snapshot admission's permit, one at a time in the process like large ingests. */
  private[chronicle] def messageFetch(config: Config,snapshots: SnapshotAdmission,dispatcher: Dispatcher[IO]): MessageFetch =
    MessageFetch(config.maxIndexingBudgetBytes,new LargeDecodes {
      def apply[A](decode: => A): A = dispatcher.unsafeRunSync(snapshots.claim(IO.blocking(decode)))
    })
  private def sqlState(error: Throwable): String = error match { case sql: java.sql.SQLException => Option(sql.getSQLState).getOrElse("unavailable"); case _ => "unavailable" }
  /** Invariant and configuration faults end the worker run (and with it the server), wherever they arise in a job. */
  private def fatal(error: DomainError): Boolean = Set("model-telemetry-invariant","internal","config").contains(error.code)
  /** How long a worker lane stays idle after recording a failed job. */
  final case class FailureBackoff(delay: FiniteDuration)
  object FailureBackoff {
    val production: FailureBackoff = FailureBackoff(2.seconds)
  }
}
