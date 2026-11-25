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
import ponygirls.runtime.{BlockingJdbcDatabase,JdbcFailure,JdbcTransient}

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
trait Embedder {
  def documents(owner: String,text: List[String]): IO[List[List[Double]]]
  def query(owner: String,text: String): IO[List[Double]]
  private[chronicle] def documentsGuarded(owner: String,text: List[String],beforeDispatch: IO[Unit]): IO[List[List[Double]]] =
    beforeDispatch *> IO.defer(documents(owner,text))
  private[chronicle] def queryGuarded(owner: String,text: String,beforeDispatch: IO[Unit]): IO[List[Double]] =
    beforeDispatch *> IO.defer(query(owner,text))
}
object ModelHttp {
  def client(config: Config): Resource[IO,Client[IO]] =
    JsonHttp.client(transportTimeout(config))
  def transportTimeout(config: Config): FiniteDuration = config.annotation.timeoutSeconds.max(config.embedding.timeoutSeconds).seconds
}
final class ModelHttp(client: Client[IO],telemetry: ModelTelemetry,admission: ModelAdmission) {
  def post(context: ModelCallContext,endpoint: String,credentialFile: String,timeout: Int,maxBytes: Int,payload: Json): IO[Json] =
    postDecoded(context,endpoint,credentialFile,timeout,maxBytes,payload)(identity)
  def postDecoded[A](context: ModelCallContext,endpoint: String,credentialFile: String,timeout: Int,maxBytes: Int,payload: Json,beforeDispatch: IO[Unit]=IO.unit)(decode: Json => A): IO[A] = IO.defer {
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
          // Admission and credential I/O can wait. Recheck here, without keeping JDBC resources across dispatch.
          // This is the authorization point, not a guarantee of recall once dispatch is authorized.
          beforeDispatch *> JsonHttp.postF(client,endpoint,credential,timeout.seconds,maxBytes,payload) { json =>
            usage.set(ProviderUsage.parse(json,context.purpose)).as(json).map(decode)
          }
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
  case StrictJsonSchema32k extends AnnotationRequestPolicy("strict-json-schema:responseTokens32768",32768)
  case GlmMaxReasoning extends AnnotationRequestPolicy("glm-max-reasoning:responseTokens65536",65536)
}
final class OpenAIEmbedder(http: ModelHttp,config: Config) extends Embedder {
  def documents(owner: String,text: List[String]): IO[List[List[Double]]] = documentsGuarded(owner,text,IO.unit)
  override private[chronicle] def documentsGuarded(owner: String,text: List[String],beforeDispatch: IO[Unit]): IO[List[List[Double]]] =
    embed(ModelCallContext(owner,ModelWorkload.IndexEmbedding),text.map(config.embedding.documentPrefix+_),beforeDispatch)
  def query(owner: String,text: String): IO[List[Double]] = queryGuarded(owner,text,IO.unit)
  override private[chronicle] def queryGuarded(owner: String,text: String,beforeDispatch: IO[Unit]): IO[List[Double]] =
    embed(ModelCallContext(owner,ModelWorkload.QueryEmbedding),List(config.embedding.queryPrefix+text),beforeDispatch).map(_.head)
  private def embed(context: ModelCallContext,text: List[String],beforeDispatch: IO[Unit]): IO[List[List[Double]]] = {
    val cfg = config.embedding
    Check(text.forall(_.getBytes(UTF_8).length <= 16384),"invalid","embedding input bound including prefix")
    Check(text.nonEmpty && text.size<=16,"invalid","embedding batch bound")
    val payload=EmbeddingCodec.payload(cfg.model,text,cfg.dimensions,cfg.sendDimensions)
    http.postDecoded(context,cfg.endpoint,cfg.credentialFile,cfg.timeoutSeconds,cfg.maxResponseBytes,payload,beforeDispatch)(identity).map { json =>
      try EmbeddingCodec.decode(json,text.size,cfg.dimensions)
      catch { case error: RetrievalError => throw DomainError(error.code,error.detail) }
    }
  }
}
final class Worker(archive: SessionArchive,problemAnnotator: ProblemPassageAnnotator,embedder: Embedder,config: Config,profiles: IndexProfileCatalog,admission: ModelAdmission,logger: logstage.IzLogger,failureBackoff: Worker.FailureBackoff,snapshots: SnapshotAdmission,leases: Worker.Leases) {
  def this(archive: SessionArchive,problemAnnotator: ProblemPassageAnnotator,embedder: Embedder,config: Config,profiles: IndexProfileCatalog,admission: ModelAdmission,logger: logstage.IzLogger,failureBackoff: Worker.FailureBackoff,snapshots: SnapshotAdmission) =
    this(archive,problemAnnotator,embedder,config,profiles,admission,logger,failureBackoff,snapshots,Worker.Leases.production)
  private val leaseSeconds = leases.lease.toSeconds.toInt
  /** `indexing.annotationContinuations` (ANNOT2), read once from the process's configuration: the one switch between the
    * annotation chain and the whole-window path every annotation of this worker takes. */
  private val annotationContinuations = config.indexing.annotationContinuations
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
  /** A failure of `continueAnnotation`, the window's paid-answer write while it continues (ANNOT2): it leaves the chain
    * unstaged, as a failure of `acceptAnnotation` and of the checkpoint write does (G2 D4 reversed per orchestrator 20:46Z). */
  private final class PaidWriteFailure(val error: Throwable) extends RuntimeException
  private def publishStage(run: => IO[Unit]): IO[Unit] = IO.defer(run).handleErrorWith(error => IO.raiseError(StagedFailure(IndexingStage.Publication,error)))
  private final class Windows(claim: Claim,total: Int) {
    private val dimensions=config.embedding.dimensions
    /** Decisions and embedding parts this attempt took from another run's accepted work (ingest-limits spec §5.4). */
    val reusedDecisions=new java.util.concurrent.atomic.AtomicInteger(0)
    val reusedParts=new java.util.concurrent.atomic.AtomicInteger(0)
    /** Windows this attempt accepted after kept answers, and windows it resumed from a stored partial (ANNOT2). */
    val continuedWindows=new java.util.concurrent.atomic.AtomicInteger(0)
    val resumedWindows=new java.util.concurrent.atomic.AtomicInteger(0)
    /** The run's accepted work (its own or by reference), else the work another run accepted for an equal input, else
      * `run`: a reused window reserves no annotation attempt and calls no model. */
    private def work[A](key: CheckpointKey)(decode: Json => A)(run: => IO[A]): IO[A] = {
      def decoded(value: Json): IO[A] = IO(decode(value)).handleErrorWith(_ => IO.raiseError(DomainError("internal","invalid accepted checkpoint payload")))
      IO.blocking(archive.windowWork(claim,key)).flatMap {
        case Some(WindowWork.Accepted(value)) => decoded(value)
        case Some(WindowWork.Reused(value)) => IO((if(key.stage==IndexingStage.Annotation) reusedDecisions else reusedParts).incrementAndGet()) *> decoded(value)
        case None => IO.defer(run)
      }
    }
    /** `work`, whose `run` result is checkpointed. */
    def accepted[A](key: CheckpointKey)(decode: Json => A,encode: A => Json)(run: => IO[A]): IO[A] =
      work(key)(decode)(IO.defer(run).flatTap(value => IO.blocking(archive.checkpoint(claim,key,encode(value)))))
    /** A window's decision and the authorization that accepted it (0: accepted earlier): its accepted work, else, with
      * `indexing.annotationContinuations` (ANNOT2), the annotation chain's complete decision, stored with the accepting
      * authorization's continuations (`acceptAnnotation`, a paid write as the checkpoint it replaces); off, the answer to a
      * request for the whole window, validated in full, checkpointed. */
    def decision(key: CheckpointKey,window: ProblemPassages.Window,state: ProblemPassages.State,index: Int): IO[(ProblemPassages.Decision,Int)] =
      if(annotationContinuations) work(key)(json => (ProblemPassages.decode(window,state.carry.nonEmpty,json),0))(annotate(key,window,state,index).flatMap { (merged,attempt,continuations) =>
        IO.blocking(archive.acceptAnnotation(claim,key,attempt,continuations,CheckpointJson.decision(merged))) *>
          IO { if(continuations>0) { continuedWindows.incrementAndGet(); () } }.as((merged,attempt))
      })
      else accepted(key)(json => (ProblemPassages.decode(window,state.carry.nonEmpty,json),0),value => CheckpointJson.decision(value._1))(
        annotate(key,index)(authorize => problemAnnotator.annotateGuarded(claim.owner,window,state.carry,authorize)
          .flatTap(value => IO(ProblemPassages.validate(window,state.carry.nonEmpty,value)))))
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
    /** Reserve after admission: an answer still needs a fenced acceptance, and a refused waiter spends no reservation. */
    private def authorizedAnnotation[A](reserve: => AnnotationReservation,index: Int)(send: IO[Unit] => IO[A]): IO[(Int,Either[Throwable,A])] =
      Ref.of[IO,Int](0).flatMap { reserved =>
        val authorize=IO.blocking(reserve).flatMap {
          case AnnotationReservation.Exhausted(reason,attempts) => failed(new AnnotationExhausted(reason),index,"annotation",attempts)
          case AnnotationReservation.Reserved(attempt) => reserved.set(attempt)
        }
        IO.defer(send(authorize)).attempt.flatMap { answer =>
          reserved.get.flatMap { attempt => answer match {
            case Left(staged: StagedFailure) => IO.raiseError(staged)
            case Left(error) if attempt==0 => failed(error,index,"annotation",0)
            case Right(_) if attempt==0 => failed(DomainError("internal","annotation dispatched without authorization"),index,"annotation",0)
            case _ => IO.pure((attempt,answer))
          }}
        }
      }
    /** One authorization of the whole window and its answer (continuations off): a `model-output` rejection is recorded
      * and the same request asked again, up to the rejection limit. */
    def annotate[A](key: CheckpointKey,index: Int)(send: IO[Unit] => IO[A]): IO[(A,Int)] =
      authorizedAnnotation(archive.reserveAnnotation(claim,key),index)(send).flatMap {
        case (attempt,Right(value)) => IO.pure((value,attempt))
        case (attempt,Left(error: DomainError)) if Set("model-output","model-output/truncated").contains(error.code) =>
          val details=failureDetails(error); val reason=details.reason; val structure=details.structure.noSpaces; val code=error.code
          IO.blocking(archive.rejectAnnotation(claim,key,attempt,reason)).flatMap { rejected =>
            IO(logger.warn(s"annotation attempt failed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total attempt=$attempt rejected=$rejected rejectionLimit=${AnnotationAttempts.rejectionLimit} reservationLimit=${AnnotationAttempts.reservationLimit} code=$code reason=$reason structure=$structure")) *>
              (if(rejected==AnnotationAttempts.rejectionLimit) failed(new AnnotationExhausted(reason),index,"annotation",attempt)
              else renewed *> annotate(key,index)(send))
          }
        case (attempt,Left(error)) => failed(error,index,"annotation",attempt)
      }.handleErrorWith {
        case staged: StagedFailure => IO.raiseError(staged)
        case error => failed(error,index,"annotation",0)
      }
    /** The kept parts of the window's chain (ANNOT2; window coordinates, committed as its partial) and the epoch's
      * non-final answers (rows with a reason) so far. */
    private final case class Chain(partial: Option[AnnotationPartial],reasons: Int) {
      def prefix: Boolean = partial.nonEmpty
      def covered: Int = partial.fold(0)(_.covered)
      def kept: Vector[ProblemPassages.Part] = partial.fold(Vector.empty[ProblemPassages.Part])(_.kept.parts)
      def continuations: Int = partial.fold(0)(_.continuations)
    }
    /** The window's complete decision, its accepting authorization and the kept answers before it (ANNOT2): from its
      * validated partial (only the rest of the window is asked) or from the full request; a stored partial that fails
      * validation is discarded, never an internal fault. */
    private def annotate(key: CheckpointKey,window: ProblemPassages.Window,state: ProblemPassages.State,index: Int): IO[(ProblemPassages.Decision,Int,Int)] =
      IO.blocking(archive.loadPartial(claim,key)).flatMap {
        case PartialLoad.Exhausted(reason,attempts) => failed(new AnnotationExhausted(reason),index,"annotation",attempts)
        case PartialLoad.Missing(reasons) => ask(key,window,state,index,Chain(None,reasons))
        case found: PartialLoad.Found =>
          val reasons=found.ledger.count(_.reason.nonEmpty)
          IO(ProblemPassages.resumable(state,window,claim.profile,key,found,problemAnnotator.tailRequestFits)).flatMap {
            case Left(discarded) =>
              val reason=discarded.code
              IO.blocking(archive.discardPartial(claim,key)) *>
                IO(logger.warn(s"annotation partial discarded jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total reason=$reason")) *>
                ask(key,window,state,index,Chain(None,reasons))
            case Right(partial) =>
              val covered=partial.covered; val fragments=window.fragments.size; val continuations=partial.continuations
              IO(resumedWindows.incrementAndGet()) *>
                IO(logger.info(s"annotation partial resumed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total coveredFragments=$covered windowFragments=$fragments continuations=$continuations")) *>
                ask(key,window,state,index,Chain(Some(partial),reasons))
          }
      }.handleErrorWith {
        case staged: StagedFailure => IO.raiseError(staged)
        case paid: PaidWriteFailure => IO.raiseError(paid.error)
        case error => failed(error,index,"annotation",0)
      }
    /** One authorization: the full window, or the rest of it after the kept parts, with the carry after them. The answer,
      * appended to the kept parts, is checked as the window's decision: complete, it is accepted; stopped at a fragment
      * boundary, it is kept (committed before the rest is asked); otherwise it is rejected and the same request asked again. */
    private def ask(key: CheckpointKey,window: ProblemPassages.Window,state: ProblemPassages.State,index: Int,chain: Chain): IO[(ProblemPassages.Decision,Int,Int)] =
      IO((chain.partial.fold(window)(value => ProblemPassages.tail(window,value.covered)),chain.partial.fold(state.carry)(value => ProblemPassages.carryAfter(state,window,value.kept.parts)))).flatMap { (request,previous) =>
        authorizedAnnotation(archive.reserveAnnotation(claim,key,chain.prefix),index) { authorize =>
          problemAnnotator.annotateGuarded(claim.owner,request,previous,authorize).flatMap { answer =>
            IO { val merged=ProblemPassages.merge(chain.covered,chain.kept,answer); (merged,ProblemPassages.coverage(window,state.carry.nonEmpty,merged)) }
          }
        }.flatMap {
          case (attempt,Right((merged,stop))) if stop==window.terminal => IO.pure((merged,attempt,chain.continuations))
          case (attempt,Right((merged,stop))) => keep(key,window,state,index,chain,attempt,merged,stop.fragmentIndex)
          case (attempt,Left(error: DomainError)) if Set("model-output","model-output/truncated").contains(error.code) =>
            val details=failureDetails(error)
            rejected(key,window,state,index,chain,attempt,details.reason,error.code,details.structure.noSpaces)
          case (attempt,Left(error)) => failed(error,index,"annotation",attempt)
        }
      }
    /** A boundary stop: kept unless it is the epoch's fifth non-final answer (then recorded as such, and the window is
      * exhausted) or the request for the rest of the window would exceed the request bounds (a rejection). */
    private def keep(key: CheckpointKey,window: ProblemPassages.Window,state: ProblemPassages.State,index: Int,chain: Chain,attempt: Int,merged: ProblemPassages.Decision,stop: Int): IO[(ProblemPassages.Decision,Int,Int)] =
      if(chain.reasons>=AnnotationAttempts.continuationLimit) rejected(key,window,state,index,chain,attempt,AnnotationAttempts.continuedReason,"model-output","{}")
      else IO(problemAnnotator.tailRequestFits(window,stop,ProblemPassages.carryAfter(state,window,merged.parts))).flatMap { fits =>
        if(!fits) rejected(key,window,state,index,chain,attempt,AnnotationAttempts.unrequestableReason,"model-output","{}")
        else {
          val partial=AnnotationPartial(merged,window.fragments.size,stop,chain.continuations+1,chain.partial.fold(Vector.empty[Int])(_.stops):+stop,chain.partial.fold(UUID.randomUUID())(_.chain))
          val fragments=window.fragments.size
          IO.blocking(archive.continueAnnotation(claim,key,attempt,partial)).handleErrorWith(error => IO.raiseError(new PaidWriteFailure(error))).flatMap { reasons =>
            IO(logger.info(s"annotation answer continued jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total attempt=$attempt coveredFragments=$stop windowFragments=$fragments")) *>
              renewed *> ask(key,window,state,index,Chain(Some(partial),reasons))
          }
        }
      }
    private def rejected(key: CheckpointKey,window: ProblemPassages.Window,state: ProblemPassages.State,index: Int,chain: Chain,attempt: Int,reason: String,code: String,structure: String): IO[(ProblemPassages.Decision,Int,Int)] =
      IO.blocking(archive.rejectAnnotation(claim,key,attempt,reason,chain.prefix)).flatMap { reasons =>
        IO(logger.warn(s"annotation attempt failed jobId=${claim.jobId} fence=${claim.fence} windowOrdinal=$index totalWindows=$total attempt=$attempt rejected=$reasons rejectionLimit=${AnnotationAttempts.rejectionLimit} reservationLimit=${AnnotationAttempts.reservationLimit} code=$code reason=$reason structure=$structure")) *>
          (if(reasons==AnnotationAttempts.rejectionLimit) failed(new AnnotationExhausted(reason),index,"annotation",attempt)
          else renewed *> ask(key,window,state,index,chain.copy(reasons=reasons)))
      }
    private def renewed: IO[Unit] = IO.blocking(Check(archive.renew(claim,leaseSeconds),"stale-claim","indexing claim is no longer current"))
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
        accepted(key)(json => validated(CheckpointJson.vectors(json)),CheckpointJson.vectors)(IO.defer {
          embedder.documentsGuarded(claim.owner,batch.map(_.text),IO.blocking(archive.authorizeModelDispatch(claim)))
        }.map(validated))
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
    * `metadataHorizonWindows` after its own (or the last one): its passage's staged final row when that reaches the last
    * window (always under the default horizon), else P2 replays a second time, that many windows ahead, for the open
    * passage's metadata there (a closed passage's is its final row). An incremental publication first rewrites the
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
      // The first piece of each window from max(window - horizon, the window the open passage opened in): the windows a
      // next version may write pieces of again.
      var firstPieces=cut.fold(Vector.empty[Long])(_.firstPieces.dropRight(1))
      var openedIn=cut.fold(0)(_.firstWindow)
      var next=Option.empty[ProblemRows.Cut]
      val steps=new Steps
      while(steps.hasNext) {
        val first=math.max(steps.index.toLong-horizon,openedIn.toLong)
        firstPieces=(firstPieces:+steps.state.nextPieceOrdinal).takeRight((steps.index-first+1).toInt)
        if(steps.index==total-1) next=Some(ProblemRows.Cut(steps.index,horizon,steps.state,context,validation.snapshot,firstPieces))
        val open=steps.state.open.map(_.passage.id)
        val (index,window,delta)=steps.step()
        delta.state.open.map(_.passage.id) match {
          case None => openedIn=index+1
          case value => if(value!=open) openedIn=index
        }
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
      /** The summary and tags of passage `ordinal` after window min(window + horizon, last window): from the last window
        * on, its staged final row (a passage open after the last window keeps its metadata when the finishing step closes it). */
      def metadata(ordinal: Int,window: Int): ProblemRows.Final =
        if(window.toLong+horizon>=total-1L) stored.passage(ordinal) else {
          lead.advance(window+horizon)
          lead.state.open.filter(_.passage.ordinal==ordinal).fold(stored.passage(ordinal))(open => ProblemRows.Final(open.passage.summary,open.passage.tags))
        }
      // The parent's pieces of B in the windows before the cut whose horizon reaches the re-done windows: a window whose
      // pieces' metadata changes is written again (its pieces under this run's ids, their texts, spans and vectors), one
      // whose metadata stays keeps its rows. A window's pieces of B were written together with one metadata (as a window
      // of a version's tail or of its rewrite region), so its first one is compared, a probe per window.
      for(value <- cut; b <- value.state.open) {
        val bFirst=value.state.nextPieceOrdinal-b.passage.pieceCount
        val windows=value.firstPieces.zip(value.firstPieces.drop(1)).zipWithIndex.iterator.map { case ((first,until),i) => (value.firstWindow+i,math.max(first,bFirst),until) }
          .filter((window,lo,until) => window>=from && lo<until)
        windows.grouped(PassageStorage.rowsPerBatch).foreach { group =>
          group.zip(stored.carried(group.map(_._2).toVector)).foreach { case ((window,lo,until),carried) =>
            val current=metadata(b.passage.ordinal,window)
            if(carried!=current) {
              val members=stored.members(lo,until)
              Check(members.map(_.ordinal.toLong)==(lo until until).toVector && members.forall(_.passageOrdinal==b.passage.ordinal),"internal","the parent's pieces of the open passage are not its members")
              write(window,members.map(member => member.copy(chunk=member.chunk.copy(id=ProblemPassages.pieceId(claim.runId,member.ordinal.toLong),summary=current.summary,tags=current.tags))))
            }
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
        deferLarge(claim,total) *> IO(Worker.waitingSeconds(claim) match {
          case None => logger.info(s"large job deferred jobId=${claim.jobId} totalWindows=$total indexedWindows=$indexed largeJobWindows=${LargeJobs.windows}")
          case Some(waitingSeconds) => logger.info(s"large job deferred jobId=${claim.jobId} totalWindows=$total indexedWindows=$indexed largeJobWindows=${LargeJobs.windows} waitingSeconds=$waitingSeconds")
        })
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
          if(annotationContinuations) {
            val continued=windows.continuedWindows.get; val resumed=windows.resumedWindows.get
            logger.info(s"windows accepted jobId=${claim.jobId} fence=${claim.fence} totalWindows=$total reusedDecisions=$decisions reusedEmbeddingParts=$parts continuedWindows=$continued resumedWindows=$resumed")
          } else logger.info(s"windows accepted jobId=${claim.jobId} fence=${claim.fence} totalWindows=$total reusedDecisions=$decisions reusedEmbeddingParts=$parts")
        }
      case Some(window) =>
        val input=Json.arr(window.sourceJson,state.carry.map(ProblemPassages.carryJson).getOrElse(Json.Null))
        val key=IndexCheckpoints.annotation(claim,index,input)
        windows.decision(key,window,state,index).flatMap { (value,attempt) =>
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
  /** The end of an attempt's lease as the worker knows it (restart-robustness spec §4): on this process's monotonic clock,
    * from before the claim or the last renewal that set it, less the skew margin; never later than the stored end. */
  private final class AttemptLease(claimed: Deadline) {
    @volatile private var tracked=claimed+leases.lease-leases.skewMargin
    def renewed(at: Deadline): Unit = tracked=at+leases.lease-leases.skewMargin
    def end: Deadline = tracked
    def timeLeft: FiniteDuration = tracked.timeLeft
  }
  private def process(claim: Claim,large: LargeJobs,lease: AttemptLease): IO[Unit] = {
    val work=Dispatcher.sequential[IO](await=true).use(dispatcher => passages(claim,large,Worker.messageFetch(config,snapshots,dispatcher)))
    val renew=(IO.sleep(leases.renewal) *> IO(Deadline.now).flatMap(at => IO.blocking(Check(archive.renew(claim,leaseSeconds),"stale-claim","indexing claim is no longer current")) *> IO(lease.renewed(at)))).foreverM
    IO.race(work,renew).void.handleErrorWith { failure =>
      val (stage,error)=failure match { case StagedFailure(stage,error) => (Some(stage),error); case error => (None,error) }
      error match {
        case error: DomainError if Worker.fatal(error) => IO.raiseError(error)
        case _ if Worker.transient(error) => holdTransient(claim,stage,error,lease)
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
  /** A transient database failure (restart-robustness spec §4): the job held with back-off, or failed at the consecutive
    * limit. The record is the fenced transaction of `fail`, tried again after a failure back-off (at most the lease left)
    * while the database cannot take it, a try's lock wait ran out, or a try reached its deadline (R-a2 M1: an unknown
    * outcome, read again under the fence), as long as the lease has `minimumTry` left; each try by one deadline
    * min(now + `leases.recordTry`, the tracked lease end); then, as any failure not recorded, the job keeps its lease.
    * Every other error is reported at once. A try writes only while the claim still holds the job; cancellation schedules
    * no further try (the one in flight ends by its deadline); no model is called meanwhile. */
  private def holdTransient(claim: Claim,stage: Option[IndexingStage],error: Throwable,lease: AttemptLease): IO[Unit] = {
    val sqlState=error match { case sql: java.sql.SQLException => Option(sql.getSQLState).getOrElse("none"); case _ => "none" }
    val errorClass=error.getClass.getSimpleName; val failureStage=stage.fold("none")(_.toString); val code=Jobs.transientCode
    def record(last: Throwable): IO[TransientOutcome] = IO(Deadline.now).flatMap { now =>
      val end=lease.end; val deadline=if(now+leases.recordTry<end) now+leases.recordTry else end
      if(end-now<BlockingJdbcDatabase.minimumTry) IO.raiseError(last)
      else IO.blocking(archive.holdTransient(claim,stage,deadline)).handleErrorWith {
        case refused if JdbcTransient.job(refused) || Worker.lockTimeout(refused) || JdbcTransient.deadline(refused) => IO.sleep(failureBackoff.delay.min(lease.timeLeft.max(Duration.Zero))) *> record(refused)
        case other => IO.raiseError(other)
      }
    }
    record(error).flatMap {
      case TransientOutcome.Held(consecutive,nextAttemptAt) =>
        IO(logger.warn(s"job held jobId=${claim.jobId} code=$code sqlState=$sqlState class=$errorClass stage=$failureStage consecutive=$consecutive nextAttemptAt=$nextAttemptAt"))
      case TransientOutcome.Exhausted(consecutive) =>
        IO(logger.warn(s"job failed jobId=${claim.jobId} code=$code sqlState=$sqlState class=$errorClass stage=$failureStage consecutive=$consecutive nextAttemptAt=none"))
      case TransientOutcome.Ended =>
        IO(logger.info(s"job not held jobId=${claim.jobId} code=$code sqlState=$sqlState class=$errorClass stage=$failureStage: the claim ended"))
    }.handleErrorWith {
      case fatal: DomainError if Worker.fatal(fatal) => IO.raiseError(fatal)
      case recording => failureNotRecorded(claim,code,recording)
    } *> IO.sleep(failureBackoff.delay)
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
      IO(Deadline.now).flatMap(claimed => IO.blocking(archive.claim(profiles.knownProfiles,ClaimScope.AllOwners,leaseSeconds,large)).redeemWith(claimFailed,{
        case None => IO.pure(Worker.Iteration.Idle)
        case Some(claim) => process(claim,large,new AttemptLease(claimed)).as(Worker.Iteration.Processed)
      }))
    }
  }
  def once: IO[Boolean] = iteration.map(_==Worker.Iteration.Processed)
  /** `indexing.claimOrder` (read at start). */
  private val claimOrder = ClaimOrderMode.of(config)
  /** One claim of `lane` in the waiting order (ClaimOrder); lane 0 runs it holding the large-job permit (`inLane`). A
    * contended claim (its probes ran out) waits like an idle one. */
  private def laneIteration(lane: ClaimLane): IO[Worker.Iteration] = admission.annotationSession.use { _ =>
    IO(Deadline.now).flatMap(claimed => IO.blocking(archive.claimInLane(profiles.knownProfiles,ClaimScope.AllOwners,leaseSeconds,lane)).redeemWith(claimFailed,{
      case ClaimOutcome.Idle | ClaimOutcome.Contended => IO.pure(Worker.Iteration.Idle)
      case ClaimOutcome.Claimed(claim) =>
        IO(claim.facts.foreach(facts => logger.log(izumi.logstage.api.Log.Level.Info)(izumi.logstage.api.Log.Message.raw(ClaimFacts.logLine(claim.jobId,facts,lane,java.time.Instant.now()))))) *>
          process(claim,lane.large,new AttemptLease(claimed)).as(Worker.Iteration.Processed)
    }))
  }
  /** Lane 0 of the waiting order owns the large-job permit while it runs; the other lanes never take it. */
  private def inLane[A](lane: ClaimLane)(work: IO[A]): IO[A] = (if(lane.kind==ClaimLane.Kind.Large) admission.largeJobOwned else Resource.unit[IO]).use(_ => work)
  /** One claim of `lane` in the waiting order (tests): true when a job was processed. */
  def onceInLane(lane: ClaimLane): IO[Boolean] = inLane(lane)(laneIteration(lane)).map(_==Worker.Iteration.Processed)
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
    def ordered(value: ClaimLane): IO[Nothing] = inLane(value)(laneIteration(value).flatMap {
      case Worker.Iteration.Processed => IO.unit
      case Worker.Iteration.Idle => IO.sleep(idleDelay)
      case Worker.Iteration.ClaimFailed => IO.sleep(failureBackoff.delay)
    }.foreverM)
    val lanes=claimOrder match {
      case ClaimOrderMode.SourceId => List.fill(config.indexing.annotationSessions)(lane)
      case ClaimOrderMode.Waiting(bulkLanes) => List.tabulate(config.indexing.annotationSessions)(index => ordered(ClaimLane.of(index,bulkLanes)))
    }
    retired *> publication *> lanes.parSequence.map(_.head)
  }
}
object Worker {
  private enum Iteration { case Processed,Idle,ClaimFailed }
  /** How long the job of a claim of the waiting order (ClaimFacts) has waited; None under today's order. */
  private def waitingSeconds(claim: Claim): Option[Long] =
    claim.facts.flatMap(_.waitingSince).map(since => java.time.Duration.between(since,java.time.Instant.now()).getSeconds)
  /** A job's message fetching (ingest-limits spec §5.2.2): within `maxIndexingBudgetBytes` per message, and a message above
    * SnapshotAdmission.largeBodyBytes under the snapshot admission's permit, one at a time in the process like large ingests. */
  private[chronicle] def messageFetch(config: Config,snapshots: SnapshotAdmission,dispatcher: Dispatcher[IO]): MessageFetch =
    MessageFetch(config.maxIndexingBudgetBytes,new LargeDecodes {
      def apply[A](decode: => A): A = dispatcher.unsafeRunSync(snapshots.claim(IO.blocking(decode)))
    })
  private def sqlState(error: Throwable): String = error match { case sql: java.sql.SQLException => Option(sql.getSQLState).getOrElse("unavailable"); case _ => "unavailable" }
  /** Invariant and configuration faults end the worker run (and with it the server), wherever they arise in a job. */
  private def fatal(error: DomainError): Boolean = Set("model-telemetry-invariant","internal","config").contains(error.code)
  /** How long a worker lane stays idle after recording a failed job; also the interval of a transient failure's record tries. */
  final case class FailureBackoff(delay: FiniteDuration)
  object FailureBackoff {
    val production: FailureBackoff = FailureBackoff(2.seconds)
  }
  /** An attempt's lease (restart-robustness spec §4): `lease` long, renewed every `renewal`, its end tracked less `skewMargin`;
    * a try of a transient failure's record ends by `recordTry` from its start (and never past the tracked end): with the
    * abort of its connection at that deadline, within 5 s (R-a2 M1). */
  final case class Leases(lease: FiniteDuration,renewal: FiniteDuration,skewMargin: FiniteDuration,recordTry: FiniteDuration)
  object Leases {
    val production: Leases = Leases(300.seconds,30.seconds,5.seconds,4500.millis)
  }
  /** Not charged to the attempts (restart-robustness spec §4): a transient database failure (JdbcTransient.job), and P0's
    * lock timeout on the staging lock of its job, held by an earlier attempt's staging transaction still in PostgreSQL. */
  private def transient(error: Throwable): Boolean = JdbcTransient.job(error) || (error match {
    case JdbcFailure(PostgresArchive.leftoverStaging,_) => true
    case _ => false
  })
  /** A record try's lock wait that ran out of the try's bound (its lock timeout): tried again like a refused record. */
  private def lockTimeout(error: Throwable): Boolean = error match {
    case JdbcFailure(_,Some(PostgresArchive.lockTimeout)) => true
    case _ => false
  }
}
