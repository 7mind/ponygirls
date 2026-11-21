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
/** What one indexing job retains until its publication (append-only ingest spec §3.1): every decoded message (the
  * publication's validation reads them all; until then the windows read them by position, ingest-limits spec §5.2.2), per Problem
  * piece its chunk in the publication builder and its vector in the job's VectorArena (whole blocks), and per Context
  * slice its coverage span. A job whose estimate exceeds `maxIndexingBudgetBytes` ends Failed with `exceededCode` before
  * its messages are decoded; a running job whose windows outgrow the estimate ends the same way before it retains them.
  * Without the large-job permit (LargeJobs) a job is held to `maxSmallJobBudgetBytes` instead, without failing: above it
  * at the claim it waits for the lane with the permit, above it while running it goes back to the queue for that lane. */
object IndexingBudget {
  val exceededCode = "index-budget-exceeded"
  /** The objects of one decoded message besides its strings. */
  val messageObjectBytes = 256
  /** A piece's chunk: source slice (at most 4,096 B as UTF-16), summary (at most 4,000 B), tags (at most 4,096 B) and objects. */
  val chunkBytes = 13312
  /** One retained Context coverage span with its collection slot, and what publication's validation sorts per span. */
  val coverageSpanBytes = 256
  /** Decoded strings take at most two bytes per UTF-8 byte of the stored message values (`messageBytes`). Every fragment
    * yields at least one piece or Context span; one piece per fragment (a span costs less than a piece) with its vector
    * in whole arena blocks. */
  def estimate(messages: Long,messageBytes: Long,fragments: Long,dimensions: Int): BigInt =
    BigInt(2)*BigInt(messageBytes)+BigInt(messageObjectBytes)*BigInt(messages)+BigInt(fragments)*BigInt(chunkBytes)+VectorArena.heldBytes(dimensions,fragments)
  /** The decoded messages' share, from their strings (two bytes per UTF-16 unit): at most the estimate's share, as a
    * string has no more UTF-16 units than UTF-8 bytes. */
  def decoded(messages: Seq[Message]): BigInt = messages.foldLeft(BigInt(0)) { (total,m) =>
    total+BigInt(2L*(m.id.length+m.role.length+m.text.length+m.parentId.fold(0)(_.length)+m.timestamp.fold(0)(_.length))+messageObjectBytes)
  }
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
  /** A job running without the large-job permit whose windows would retain more than maxSmallJobBudgetBytes: it goes back
    * to the queue for the lane with the permit. */
  private final class SmallJobOutgrown(val retained: BigInt) extends RuntimeException("small-job-budget")
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
  private final class Windows(claim: Claim,total: Int,large: LargeJobs,decoded: BigInt) {
    private val dimensions=config.embedding.dimensions
    private val vectors=new VectorArena(dimensions)
    /** The pieces and Context spans the publication holds once the windows so far are appended, and the vectors in the
      * arena, counted as they are added: a part added again after an input mismatch is held twice and counted twice. */
    private var pieces=0L
    private var spans=0L
    private var added=0L
    private def within(pieces: Long,spans: Long,vectors: Long): Unit = {
      val retained=decoded+BigInt(pieces)*BigInt(IndexingBudget.chunkBytes)+BigInt(spans)*BigInt(IndexingBudget.coverageSpanBytes)+VectorArena.heldBytes(dimensions,vectors)
      Check(retained<=BigInt(config.maxIndexingBudgetBytes),IndexingBudget.exceededCode,s"indexing job would retain $retained bytes, above the budget of ${config.maxIndexingBudgetBytes}")
      if(large==LargeJobs.Skipped && retained>BigInt(config.maxSmallJobBudgetBytes)) throw new SmallJobOutgrown(retained)
    }
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
    /** Embeds the window's pieces. Before anything of the window is retained, its pieces, Context spans and vectors must
      * fit the budget with everything retained so far; each part is checked again with the vectors the arena holds. */
    def embed(delta: ProblemPassages.Delta,index: Int,attempt: Int): IO[List[IndexedChunk]] = {
      val chunks=delta.pieces.map(_.chunk).toList
      val batchSize=config.indexing.embeddingBatchSize
      val batches=chunks.grouped(batchSize).toList
      val admitted=IO {
        within(pieces+chunks.size,spans+delta.context.size,added+chunks.size)
        pieces+=chunks.size; spans+=delta.context.size
      }
      val parts=batches.zipWithIndex.traverse { (batch,part) =>
        val key=IndexCheckpoints.key(claim,IndexingStage.Embedding,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,CheckpointJson.chunks(batch))
        def validated(vectors: List[List[Double]]): List[List[Double]] = { CheckpointJson.validateVectors(vectors,batch.size,dimensions); vectors }
        IO(within(pieces,spans,added+batch.size)) *> accepted(key)(json => validated(CheckpointJson.vectors(json)),CheckpointJson.vectors)(IO.defer(embedder.documents(claim.owner,batch.map(_.text))).map(validated))
          .map(batchVectors => batch.zip(batchVectors).map { (chunk,vector) => added+=1; IndexedChunk(chunk,vectors.add(vector)) })
      }.map(_.flatten)
      // A part accepted under another batch size addresses other pieces: none of the window's parts is reused.
      (admitted *> parts.recoverWith { case _: CheckpointInputMismatch =>
        IO.blocking(archive.discardCheckpoints(claim,IndexingStage.Embedding,index)).flatMap { discarded =>
          val currentParts=batches.size
          IO(logger.warn(s"accepted work discarded jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total stage=embedding discardedParts=$discarded currentParts=$currentParts embeddingBatchSize=$batchSize"))
        } *> parts
      }).handleErrorWith {
        case outgrown: SmallJobOutgrown => IO.raiseError(outgrown)
        case error => failed(error,index,"embedding",attempt)
      }
    }
  }
  /** The count pass, through the reader the windows use: the source's windows and the decoded messages' share of the
    * estimate (IndexingBudget.decoded; a pass reads each message once). */
  private def count(claim: Claim,fetch: MessageFetch): (Int,BigInt) = {
    val messages=claim.messages.reader(fetch)
    var decoded=BigInt(0)
    val source=ProblemPassages.Source(new ProblemPassages.SourceMessages {
      def count: Int = messages.count
      def read(from: Int): Vector[Message] = { val read=messages.read(from); decoded+=IndexingBudget.decoded(read); read }
    })
    var cursor=ProblemPassages.SourceCursor.start
    var total=0
    var next=source.next(cursor)
    while(next.nonEmpty) {
      Check(total<Int.MaxValue,"internal","source window count overflow")
      total+=1; cursor=next.get.next; next=source.next(cursor)
    }
    (total,decoded)
  }
  /** A message above SnapshotAdmission.largeBodyBytes is fetched and decoded under the snapshot admission's permit, one
    * at a time in the process like large ingests (ingest-limits spec §5.2.2). */
  private def fetch(dispatcher: Dispatcher[IO]): MessageFetch = MessageFetch(config.maxIndexingBudgetBytes,new LargeDecodes {
    def apply[A](decode: => A): A = dispatcher.unsafeRunSync(snapshots.claim(IO.blocking(decode)))
  })
  private def passages(claim: Claim,large: LargeJobs,fetch: MessageFetch): IO[Unit] = IO.blocking(count(claim,fetch)).flatMap { (total,decoded) =>
    if(total>LargeJobs.windows && large==LargeJobs.Skipped)
      deferLarge(claim,total) *> IO(logger.info(s"large job deferred jobId=${claim.jobId} totalWindows=$total largeJobWindows=${LargeJobs.windows}"))
    else indexWindows(claim,ProblemPassages.Source(claim.messages.reader(fetch)),total,large,decoded).recoverWith { case outgrown: SmallJobOutgrown =>
      val retained=outgrown.retained
      deferLarge(claim,total) *> IO(logger.info(s"job outgrew the small-job budget, deferred jobId=${claim.jobId} totalWindows=$total retainedBytes=$retained smallJobBudget=${config.maxSmallJobBudgetBytes}"))
    }
  }
  /** Back to the queue with its window count and without the attempt: claims that skip large jobs pass it by. */
  private def deferLarge(claim: Claim,total: Int): IO[Unit] =
    IO.blocking(Check(archive.defer(claim,total),"stale-claim","indexing claim is no longer current"))
  private def indexWindows(claim: Claim,source: ProblemPassages.Source,total: Int,large: LargeJobs,decoded: BigInt): IO[Unit] = {
    val windows=new Windows(claim,total,large,decoded)
    // A window reads its messages from the database.
    def loop(state: ProblemPassages.State,publication: ProblemsPublication.Builder,index: Int): IO[Unit] = IO.blocking(source.next(state.nextSource)).flatMap { pending =>
      pending match {
        case None => publishStage(IO.blocking {
          Check(index==total,"internal","source window count changed")
          val finished=ProblemPassages.finish(state,source)
          Check(archive.publishProblems(claim,publication.append(finished,Nil).result),"stale-claim","indexing claim is no longer current")
        })
        case Some(window) =>
          val input=Json.arr(window.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
          val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,index,0,ProblemPassages.identity,input)
          val decision=windows.accepted(key)(json => (ProblemPassages.decode(window,state.carry.nonEmpty,json),0),value => CheckpointJson.decision(value._1))(
            windows.annotate(key,problemAnnotator.annotate(claim.owner,window,state.carry).flatTap(value => IO(ProblemPassages.validate(window,state.carry.nonEmpty,value))),index))
          decision.flatMap { (value,attempt) =>
            IO(ProblemPassages.accept(state,window,value)).handleErrorWith(_ => IO.raiseError(DomainError("internal","invalid accepted annotation state"))).flatMap { delta =>
              windows.embed(delta,index,attempt).flatMap { indexed =>
                val next=publication.append(delta,indexed)
                windows.report(index+1) *> loop(delta.state,next,index+1)
              }
            }
          }
      }
    }
    windows.report(0) *> loop(ProblemPassages.State.start(claim.sessionId,claim.runId),ProblemsPublication.empty,0)
  }
  private def process(claim: Claim,large: LargeJobs): IO[Unit] = {
    val work=Dispatcher.sequential[IO](await=true).use(dispatcher => passages(claim,large,fetch(dispatcher)))
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
    val lane: IO[Nothing]=iteration.flatMap {
      case Worker.Iteration.Processed => IO.unit
      case Worker.Iteration.Idle => IO.sleep(idleDelay)
      case Worker.Iteration.ClaimFailed => IO.sleep(failureBackoff.delay)
    }.foreverM
    List.fill(config.indexing.annotationSessions)(lane).parSequence.map(_.head)
  }
}
object Worker {
  private enum Iteration { case Processed,Idle,ClaimFailed }
  private def sqlState(error: Throwable): String = error match { case sql: java.sql.SQLException => Option(sql.getSQLState).getOrElse("unavailable"); case _ => "unavailable" }
  /** Invariant and configuration faults end the worker run (and with it the server), wherever they arise in a job. */
  private def fatal(error: DomainError): Boolean = Set("model-telemetry-invariant","internal","config").contains(error.code)
  /** How long a worker lane stays idle after recording a failed job. */
  final case class FailureBackoff(delay: FiniteDuration)
  object FailureBackoff {
    val production: FailureBackoff = FailureBackoff(2.seconds)
  }
}
