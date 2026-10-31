package chronicle
import chronicle.api.*
import cats.effect.{IO,Ref,Resource}
import cats.syntax.all.*
import org.http4s.{Request,Method,Uri,Header}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import io.circe.Json
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8
import scala.concurrent.duration.*

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
trait Embedder { def documents(owner: String,text: List[String]): IO[List[List[Double]]]; def query(owner: String,text: String): IO[List[Double]] }
object ModelHttp {
  def client(config: Config): Resource[IO,Client[IO]] =
    EmberClientBuilder.default[IO].withTimeout(transportTimeout(config)).withIdleConnectionTime(transportTimeout(config)).withMaxResponseHeaderSize(16384).build
  def transportTimeout(config: Config): FiniteDuration = config.annotation.timeoutSeconds.max(config.embedding.timeoutSeconds).seconds
}
final class ModelHttp(client: Client[IO],telemetry: ModelTelemetry,admission: ModelAdmission) {
  def post(context: ModelCallContext,endpoint: String,credentialFile: String,timeout: Int,maxBytes: Int,payload: Json): IO[Json] =
    postDecoded(context,endpoint,credentialFile,timeout,maxBytes,payload)(identity)
  def postDecoded[A](context: ModelCallContext,endpoint: String,credentialFile: String,timeout: Int,maxBytes: Int,payload: Json)(decode: Json => A): IO[A] = IO.defer {
    val uri = Uri.fromString(endpoint).fold(_ => throw DomainError("config","invalid model endpoint"),identity)
    val credential = Config.credential(credentialFile)
    val base = Request[IO](Method.POST,uri).withEntity(payload.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"))
    val req = if(credential.isEmpty) base else base.putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $credential"))
    admission.request(context.purpose).use { _ => Ref.of[IO,ProviderUsage](ProviderUsage.unknown).flatMap { usage =>
      Resource.makeCase(telemetry.begin(context)) { (ticket,exit) =>
        val outcome=exit match {
          case Resource.ExitCase.Succeeded => ModelCallOutcome.Complete
          case Resource.ExitCase.Errored(_) => ModelCallOutcome.Failed
          case Resource.ExitCase.Canceled => ModelCallOutcome.Cancelled
        }
        usage.get.flatMap(value => telemetry.finish(ticket,outcome,value))
      }.use { _ =>
        client.run(req).use { response =>
          if(!response.status.isSuccess) IO.raiseError(DomainError("model-http",s"model returned HTTP ${response.status.code}"))
          else response.body.take(maxBytes.toLong+1).compile.to(Array).flatMap { bytes => IO.uncancelable { _ =>
            IO { if(bytes.length>maxBytes) throw ModelRejection.from(ModelRejectionReason.ResponseByteBound); ModelOutput.parse(new String(bytes,UTF_8)) }
              .flatTap(json => usage.set(ProviderUsage.parse(json,context.purpose))).map(decode)
          }}
        }.timeoutTo(timeout.seconds,IO.raiseError(DomainError("model-timeout","model deadline exceeded")))
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
    val fields=List("model"->Json.fromString(cfg.model),"input"->Json.arr(text.map(Json.fromString)*),"encoding_format"->Json.fromString("float"))
    val payload=Json.obj((fields++(if(cfg.sendDimensions) List("dimensions"->Json.fromInt(cfg.dimensions)) else Nil))*)
    http.post(context,cfg.endpoint,cfg.credentialFile,cfg.timeoutSeconds,cfg.maxResponseBytes,payload).map { r =>
      val data = r.hcursor.get[List[Json]]("data").fold(_ => throw DomainError("model-output","missing embedding data"),identity)
      Check(data.size==text.size,"model-output","embedding count mismatch")
      val indexed = data.map { j =>
        val i = j.hcursor.get[Int]("index").fold(_ => throw DomainError("model-output","missing embedding index"),identity)
        val v = j.hcursor.get[List[Double]]("embedding").fold(_ => throw DomainError("model-output","invalid embedding"),identity)
        Check(v.size==cfg.dimensions && v.forall(_.isFinite) && v.exists(_ != 0.0),"model-output","invalid vector dimension/value")
        (i,v)
      }
      Check(indexed.map(_._1).sorted == text.indices.toList,"model-output","invalid embedding indices")
      indexed.sortBy(_._1).map(_._2)
    }
  }
}
final class Worker(archive: SessionArchive,problemAnnotator: ProblemPassageAnnotator,embedder: Embedder,config: Config,profiles: IndexProfileCatalog,admission: ModelAdmission,logger: logstage.IzLogger) {
  private val leaseSeconds = 300
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
    def embed(chunks: List[Chunk],index: Int,attempt: Int): IO[List[IndexedChunk]] =
      chunks.grouped(config.indexing.embeddingBatchSize).toList.zipWithIndex.traverse { (batch,part) =>
        val key=IndexCheckpoints.key(claim,IndexingStage.Embedding,index,part,EmbeddingSpaceDescriptor.from(config.embedding).id,CheckpointJson.chunks(batch))
        def validated(vectors: List[List[Double]]): List[List[Double]] = { CheckpointJson.validateVectors(vectors,batch.size,config.embedding.dimensions); vectors }
        accepted(key)(json => validated(CheckpointJson.vectors(json)),CheckpointJson.vectors)(IO.defer(embedder.documents(claim.owner,batch.map(_.text))).map(validated))
          .map(vectors => batch.zip(vectors).map(IndexedChunk.apply.tupled))
      }.map(_.flatten).handleErrorWith(error => failed(error,index,"embedding",attempt))
  }
  private def count(source: ProblemPassages.Source): Int = {
    var cursor=ProblemPassages.SourceCursor.start
    var total=0
    var next=source.next(cursor)
    while(next.nonEmpty) {
      Check(total<Int.MaxValue,"internal","source window count overflow")
      total+=1; cursor=next.get.next; next=source.next(cursor)
    }
    total
  }
  private def passages(claim: Claim): IO[Unit] = IO.blocking {
    val source=ProblemPassages.Source(claim.snapshot.messages)
    (source,count(source))
  }.flatMap { (source,total) =>
    val windows=new Windows(claim,total)
    def loop(state: ProblemPassages.State,publication: ProblemsPublication.Builder,index: Int): IO[Unit] = IO.defer {
      source.next(state.nextSource) match {
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
              windows.embed(delta.pieces.map(_.chunk).toList,index,attempt).flatMap { indexed =>
                val next=publication.append(delta,indexed)
                windows.report(index+1) *> loop(delta.state,next,index+1)
              }
            }
          }
      }
    }
    windows.report(0) *> loop(ProblemPassages.State.start(claim.sessionId,claim.runId),ProblemsPublication.empty,0)
  }
  private def process(claim: Claim): IO[Unit] = {
    val work=IO.defer {
      Check(profiles.resolve(claim.profile).policy==IndexPolicy.ContextAwareProblemsV1,"unavailable","index policy is retired; explicit rebuild required")
      passages(claim)
    }
    val renew=(IO.sleep(30.seconds) *> IO.blocking(Check(archive.renew(claim,leaseSeconds),"stale-claim","indexing claim is no longer current"))).foreverM
    IO.race(work,renew).void.handleErrorWith { failure =>
      val (stage,error)=failure match { case StagedFailure(stage,error) => (Some(stage),error); case error => (None,error) }
      error match {
        case error: DomainError if Set("model-telemetry-invariant","internal","config").contains(error.code) => IO.raiseError(error)
        case _ =>
          val code=failureCode(error)
          val exceptionClass=error.getClass.getName
          val origin=failureOrigin(error); val details=failureDetails(error); val reason=details.reason; val httpStatus=details.httpStatus
          IO(logger.warn(s"job failed jobId=${claim.jobId} code=$code exceptionClass=$exceptionClass origin=$origin reason=$reason httpStatus=$httpStatus")) *> IO.blocking {
            stage match { case Some(value) => archive.fail(claim,code,value); case None => archive.fail(claim,code) }
          } *> IO.sleep(2.seconds)
      }
    }
  }
  def once: IO[Boolean] = admission.annotationSession.use { _ =>
    IO.blocking(archive.claim(profiles.knownProfiles,ClaimScope.AllOwners,leaseSeconds)).flatMap {
      case None => IO.pure(false)
      case Some(claim) => process(claim).as(true)
    }
  }
  def run: IO[Nothing] = {
    val lane: IO[Nothing]=(once.flatMap(found => if(found) IO.unit else IO.sleep(1.second))).foreverM
    List.fill(config.indexing.annotationSessions)(lane).parSequence.map(_.head)
  }
}
