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
    /** Decisions and embedding parts this attempt took from another run's accepted work (ingest-limits spec §5.4). */
    val reusedDecisions=new java.util.concurrent.atomic.AtomicInteger(0)
    val reusedParts=new java.util.concurrent.atomic.AtomicInteger(0)
    /** The run's accepted work (its own or by reference), else the work another run accepted for an equal input, else
      * `run`: a reused window reserves no annotation attempt and calls no model. */
    def accepted[A](key: CheckpointKey)(decode: Json => A,encode: A => Json)(run: => IO[A]): IO[A] = {
      def decoded(value: Json): IO[A] = IO(decode(value)).handleErrorWith(_ => IO.raiseError(DomainError("internal","invalid accepted checkpoint payload")))
      IO.blocking(archive.windowWork(claim,key)).flatMap {
        case Some(WindowWork.Accepted(value)) => decoded(value)
        case Some(WindowWork.Reused(value)) => IO((if(key.stage==IndexingStage.Annotation) reusedDecisions else reusedParts).incrementAndGet()) *> decoded(value)
        case None => IO.defer(run).flatTap(value => IO.blocking(archive.checkpoint(claim,key,encode(value))))
      }
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
        val key=IndexCheckpoints.embedding(claim,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,batch)
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
    * an internal fault: phase W accepted every one), validated window by window (ProblemRows.Validation), from window 0 or,
    * for an incremental publication (§5.6.2), from the parent's cut. A piece carries its passage's metadata after the window
    * `metadataHorizonWindows` after its own (or the last one): P2 replays a second time, that many windows ahead, for the
    * open passage's metadata there (a closed passage's is its final row). An incremental publication first rewrites the
    * parent's pieces of the open passage B in the windows before the cut whose metadata that changes. Each pass reads the
    * source once; nothing of a window is kept after it. */
  private final class Replay(claim: Claim,total: Int,fetch: MessageFetch,val parent: Option[PublicationParent]) extends ProblemRows {
    private val dimensions=config.embedding.dimensions
    private val horizon=config.indexing.metadataHorizonWindows
    private val cut=parent.map(_.cut)
    private def accepted(key: CheckpointKey): Json = archive.checkpoint(claim,key).getOrElse(throw DomainError("internal","accepted window result missing for the publication"))
    /** The windows from window 0 or the cut on, one at a time. */
    private final class Steps {
      private val source=ProblemPassages.Source(claim.messages.reader(fetch))
      var state: ProblemPassages.State=cut.fold(ProblemPassages.State.start(claim.sessionId,claim.runId))(_.state)
      /** The next window's index. */
      var index: Int=cut.fold(0)(_.window)
      private var next=source.next(state.nextSource)
      def hasNext: Boolean = next.nonEmpty
      def step(): (Int,ProblemPassages.Window,ProblemPassages.Delta) = {
        val value=next.get
        val input=Json.arr(value.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
        val decision=ProblemPassages.decode(value,state.carry.nonEmpty,accepted(IndexCheckpoints.annotation(claim,index,input)))
        val delta=ProblemPassages.accept(state,value,decision)
        val result=(index,value,delta)
        state=delta.state; index+=1; next=source.next(state.nextSource)
        result
      }
      /** Steps until the state is the one after window `window`. */
      def advance(window: Int): Unit = while(index<=window && hasNext) step()
      def finish(): ProblemPassages.Delta = {
        Check(index==total,"internal","source window count changed")
        ProblemPassages.finish(state,source)
      }
    }
    def passages(from: Int)(write: (Int,ProblemRows.Passages) => Unit): ProblemRows.Replayed = {
      val validation=new ProblemRows.Validation(claim.sessionId,cut.map(_.validation))
      val spans=new ProblemRows.Spans(cut.toVector.flatMap(value => value.state.open.map(open => ProblemPassages.SpanUpdate(open.passage.id,open.passage.spanCount-1,open.lastSpan))))
      var context=cut.fold(0L)(_.context)
      def step(index: Int,delta: ProblemPassages.Delta,released: Vector[ProblemPassages.SpanUpdate],opened: Vector[ProblemPassages.Passage]): Unit = {
        val coverage=delta.context.zipWithIndex.map((span,i) => (context+i,span)); context+=delta.context.size
        if(index>=from) write(index,ProblemRows.Passages(opened,delta.passages.filter(_.closed).map(_.passage),released,coverage))
      }
      // Passages first seen by this publication: from the open passage B on, which an incremental one writes again.
      var seen=cut.fold(0)(value => value.state.open.fold(value.state.nextPassageOrdinal)(_.passage.ordinal))
      val cutting=horizon<=ProblemRows.metadataHorizonWindows
      var firstPieces=cut.fold(Vector.empty[Long])(_.firstPieces.dropRight(1))
      var next=Option.empty[ProblemRows.Cut]
      val steps=new Steps
      while(steps.hasNext) {
        if(cutting) {
          firstPieces=(firstPieces:+steps.state.nextPieceOrdinal).takeRight(horizon+1)
          if(steps.index==total-1) next=Some(ProblemRows.Cut(steps.index,horizon,steps.state,context,validation.snapshot,firstPieces))
        }
        val (index,window,delta)=steps.step()
        val released=spans.step(delta)
        validation.window(window,delta,released)
        val opened=delta.passages.filter(update => !update.closed && update.passage.ordinal>=seen).map(_.passage)
        seen=delta.state.nextPassageOrdinal
        step(index,delta,released,opened)
      }
      val finished=steps.finish()
      val released=spans.step(finished)
      val counts=validation.finish(total+1,finished,released)
      step(total,finished,released,Vector.empty)
      ProblemRows.Replayed(counts,next)
    }
    def pieces(from: Int,stored: ProblemRows.Stored)(write: (Int,Vector[ProblemRows.Piece]) => Unit): Unit = {
      val lead=new Steps
      /** The summary and tags of passage `ordinal` after window min(window + horizon, last window). */
      def metadata(ordinal: Int,window: Int): ProblemRows.Final = {
        lead.advance(math.min(window.toLong+horizon,total-1L).toInt)
        lead.state.open.filter(_.passage.ordinal==ordinal).fold(stored.passage(ordinal))(open => ProblemRows.Final(open.passage.summary,open.passage.tags))
      }
      // The parent's pieces of B in the windows before the cut whose horizon reaches the re-done windows: a window whose
      // pieces' metadata changes is written again (its pieces under this run's ids, their texts, spans and vectors), one
      // whose metadata stays keeps its rows.
      for(value <- cut; b <- value.state.open) {
        val bFirst=value.state.nextPieceOrdinal-b.passage.pieceCount
        value.firstPieces.zip(value.firstPieces.drop(1)).zipWithIndex.foreach { case ((first,until),i) =>
          val window=value.firstWindow+i; val lo=math.max(first,bFirst)
          if(window>=from && lo<until) {
            val members=stored.members(lo,until)
            Check(members.map(_.ordinal.toLong)==(lo until until).toVector && members.forall(_.passageOrdinal==b.passage.ordinal),"internal","the parent's pieces of the open passage are not its members")
            val current=metadata(b.passage.ordinal,window)
            if(members.exists(member => member.chunk.summary!=current.summary || member.chunk.tags!=current.tags))
              write(window,members.map(member => member.copy(chunk=member.chunk.copy(id=ProblemPassages.pieceId(claim.runId,member.ordinal.toLong),summary=current.summary,tags=current.tags))))
          }
        }
      }
      val trail=new Steps
      while(trail.hasNext) {
        val (index,_,delta)=trail.step()
        if(index>=from) {
          val chunks=delta.pieces.map(_.chunk).toList
          val vectors=chunks.grouped(config.indexing.embeddingBatchSize).zipWithIndex.flatMap { (batch,part) =>
            val key=IndexCheckpoints.embedding(claim,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,batch)
            val values=try CheckpointJson.vectors(accepted(key)) catch { case _: CheckpointInputMismatch => throw DomainError("internal","accepted embedding of another grouping for the publication") }
            CheckpointJson.validateVectors(values,batch.size,dimensions); values
          }.toVector
          val ordinals=delta.passages.map(update => update.passage.id->update.passage.ordinal).toMap
          write(index,delta.pieces.zip(vectors).map { (piece,vector) =>
            val ordinal=ordinals.getOrElse(piece.passageId,throw DomainError("internal","publication piece without its passage"))
            val value=metadata(ordinal,index)
            Check(piece.ordinal<=Int.MaxValue,"internal","publication piece ordinal exceeds the chunk ordinal range")
            ProblemRows.Piece(ordinal,piece.ordinal.toInt,piece.chunk.copy(summary=value.summary,tags=value.tags),vector,piece.sourceSpan)
          })
        }
      }
      trail.finish()
      ()
    }
  }
  /** The count pass, through the reader the windows use: the source's windows (an incremental publication's from the
    * parent's cut on, after the windows before it). */
  private def count(claim: Claim,fetch: MessageFetch,parent: Option[PublicationParent]): Int = {
    val source=ProblemPassages.Source(claim.messages.reader(fetch))
    var cursor=parent.fold(ProblemPassages.SourceCursor.start)(_.cut.state.nextSource)
    var total=parent.fold(0)(_.cut.window)
    var next=source.next(cursor)
    while(next.nonEmpty) {
      Check(total<Int.MaxValue,"internal","source window count overflow")
      total+=1; cursor=next.get.next; next=source.next(cursor)
    }
    total
  }
  /** A job whose published generation it may continue (ingest-limits spec §5.6.2) indexes and publishes the windows from
    * that generation's cut on; any other one all its windows. Large is what the job indexes. */
  private def passages(claim: Claim,large: LargeJobs,fetch: MessageFetch): IO[Unit] = IO.blocking(archive.publicationParent(claim)).flatMap { parent =>
    IO.blocking(count(claim,fetch,parent)).flatMap { total =>
      val indexed=total-parent.fold(0)(_.cut.window)
      if(indexed>LargeJobs.windows && large==LargeJobs.Skipped)
        deferLarge(claim,total) *> IO(logger.info(s"large job deferred jobId=${claim.jobId} totalWindows=$total indexedWindows=$indexed largeJobWindows=${LargeJobs.windows}"))
      else indexWindows(claim,ProblemPassages.Source(claim.messages.reader(fetch)),total,parent) *> publish(claim,total,fetch,parent)
    }
  }
  /** Back to the queue with its window count and without the attempt: claims that skip large jobs pass it by. */
  private def deferLarge(claim: Claim,total: Int): IO[Unit] =
    IO.blocking(Check(archive.defer(claim,total),"stale-claim","indexing claim is no longer current"))
  /** Phase W (ingest-limits spec §5.2.3): each window's decision and embedding parts accepted (checkpointed) in order;
    * between windows only the passage state with its bounded carry is kept. A window whose input (source and carry) an
    * earlier run of the source accepted reuses that output by reference (§5.4): after an append, the windows below the
    * previous revision's last one. */
  private def indexWindows(claim: Claim,source: ProblemPassages.Source,total: Int,parent: Option[PublicationParent]): IO[Unit] = {
    val windows=new Windows(claim,total)
    // A window reads its messages from the database.
    def loop(state: ProblemPassages.State,index: Int): IO[Unit] = IO.blocking(source.next(state.nextSource)).flatMap {
      case None =>
        IO(Check(index==total,"internal","source window count changed")) *> IO {
          val decisions=windows.reusedDecisions.get; val parts=windows.reusedParts.get
          logger.info(s"windows accepted jobId=${claim.jobId} fence=${claim.fence} totalWindows=$total reusedDecisions=$decisions reusedEmbeddingParts=$parts")
        }
      case Some(window) =>
        val input=Json.arr(window.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
        val key=IndexCheckpoints.annotation(claim,index,input)
        val decision=windows.accepted(key)(json => (ProblemPassages.decode(window,state.carry.nonEmpty,json),0),value => CheckpointJson.decision(value._1))(
          windows.annotate(key,problemAnnotator.annotate(claim.owner,window,state.carry).flatTap(value => IO(ProblemPassages.validate(window,state.carry.nonEmpty,value))),index))
        decision.flatMap { (value,attempt) =>
          IO(ProblemPassages.accept(state,window,value)).handleErrorWith(_ => IO.raiseError(DomainError("internal","invalid accepted annotation state"))).flatMap { delta =>
            windows.embed(delta,index,attempt) *> windows.report(index+1) *> loop(delta.state,index+1)
          }
        }
    }
    val first=parent.fold(0)(_.cut.window)
    windows.report(first) *> loop(parent.fold(ProblemPassages.State.start(claim.sessionId,claim.runId))(_.cut.state),first)
  }
  /** Phase P and the switch (ingest-limits spec §5.2.4), then the retirement of the replaced generation's search rows: the
    * job is Complete once switched, so a failed retirement is left to the maintenance pass. */
  private def publish(claim: Claim,total: Int,fetch: MessageFetch,parent: Option[PublicationParent]): IO[Unit] = {
    val kind=parent.fold("root")(value => s"incremental parent=${value.generation} parentVersion=${value.version} cutWindow=${value.cut.window}")
    IO(logger.info(s"publication started jobId=${claim.jobId} fence=${claim.fence} totalWindows=$total publication=$kind")) *>
    publishStage(IO.blocking(Check(archive.publishProblems(claim,new Replay(claim,total,fetch,parent)),"stale-claim","indexing claim is no longer current"))).timed.flatMap { (elapsed,_) =>
      val seconds=elapsed.toSeconds
      IO(logger.info(s"publication switched jobId=${claim.jobId} fence=${claim.fence} totalWindows=$total seconds=$seconds"))
    } *>
      IO.blocking(archive.retire(claim)).handleErrorWith { error =>
        val exceptionClass=error.getClass.getName; val sqlState=Worker.sqlState(error)
        IO(logger.warn(s"search row retirement left to maintenance jobId=${claim.jobId} exceptionClass=$exceptionClass sqlState=$sqlState"))
      }
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
    val publication=IO {
      val incremental=config.indexing.incrementalPublication; val horizon=config.indexing.metadataHorizonWindows
      logger.info(s"indexing publication incrementalPublication=$incremental metadataHorizonWindows=$horizon")
    }
    retired *> publication *> List.fill(config.indexing.annotationSessions)(lane).parSequence.map(_.head)
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
