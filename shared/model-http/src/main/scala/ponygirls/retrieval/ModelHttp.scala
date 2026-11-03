package ponygirls.retrieval

import cats.effect.{IO,Ref,Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import io.circe.Json
import org.http4s.{Header,Method,Request,Uri}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.typelevel.ci.CIString
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path,LinkOption,StandardOpenOption}
import scala.util.Using
import scala.concurrent.duration.*

/** Full operation URL and explicit credential reference. Empty file contents mean no auth;
  * an absent/unreadable file is an error, never an ambient credential fallback.
  */
final case class EmbeddingEndpoint(operationUrl: String,model: String,revision: String,dimensions: Int,sendDimensions: Boolean,documentPrefix: String,queryPrefix: String,normalization: String,credentialFile: String,deadline: FiniteDuration,maxResponseBytes: Int,maxBatch: Int,maxInputBytes: Int,maxRequestBytes: Int) {
  override def toString: String = "EmbeddingEndpoint(<redacted>)"
  def space: EmbeddingSpace = EmbeddingSpace(RetrievalChecks.hash(operationUrl),model,revision,dimensions,sendDimensions,queryPrefix,documentPrefix,normalization)
  def validate(): Unit = {
    JsonHttp.operationUri(operationUrl); space.validate()
    RetrievalChecks(credentialFile.nonEmpty && deadline>Duration.Zero && deadline<=1.day && maxResponseBytes>0 && maxRequestBytes>0 && maxInputBytes>0 && maxBatch>=1 && maxBatch<=1024,"config","invalid embedding bounds")
  }
}

/** No service policy/telemetry/annotation prompts. Can be composed with existing admission resources. */
object JsonHttp {
  private final case class DecoderFailure(error: Throwable) extends RuntimeException(null,null,false,false)
  def operationUri(endpoint: String): Uri = {
    val uri=Uri.fromString(endpoint).fold(_ => throw RetrievalError("config","invalid model endpoint"),identity)
    RetrievalChecks(Set("http","https").contains(uri.scheme.fold("")(_.value)) && uri.host.nonEmpty && uri.userInfo.isEmpty && uri.fragment.isEmpty,"config","full HTTP operation URL required")
    uri
  }
  def client(deadline: FiniteDuration): Resource[IO,Client[IO]] = {
    RetrievalChecks(deadline>Duration.Zero,"config","finite model transport deadline required")
    EmberClientBuilder.default[IO].withTimeout(deadline).withIdleConnectionTime(deadline).withMaxResponseHeaderSize(16384).build
  }
  def credential(path: String): IO[String] = IO.blocking {
    try {
      // Explicit, trusted operator references may be managed symlinks (agenix).
      // Resolve on every call, require regular leaf, and bound ACTUAL bytes read.
      // This is not the adversarial payload-path filesystem capability boundary.
      val file=Path.of(path)
      RetrievalChecks(file.isAbsolute,"config","model credential file unavailable")
      val resolved=file.toRealPath()
      RetrievalChecks(Files.isRegularFile(resolved,LinkOption.NOFOLLOW_LINKS),"config","model credential file unavailable")
      val bytes=Using.resource(Files.newInputStream(resolved,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS))(_.readNBytes(16385))
      RetrievalChecks(bytes.length<=16384,"config","model credential exceeds bound")
      val value=UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString.stripTrailing()
      RetrievalChecks(!value.exists(c => c<' ' || c==127.toChar),"config","invalid model credential")
      value
    } catch { case error: RetrievalError => throw error; case _: Exception => throw RetrievalError("config","model credential file unavailable") }
  }
  def post[A](client: Client[IO],endpoint: String,credential: String,deadline: FiniteDuration,maxBytes: Int,payload: Json)(decode: Json => A): IO[A] =
    postF(client,endpoint,credential,deadline,maxBytes,payload)(json => IO(decode(json)))
  /** Capture accepted usage/output BEFORE releasing response resources. Cancellation
    * during release must not erase already accepted counters (Chronicle contract).
    */
  def postF[A](client: Client[IO],endpoint: String,credential: String,deadline: FiniteDuration,maxBytes: Int,payload: Json)(decode: Json => IO[A]): IO[A] = IO.defer {
    RetrievalChecks(deadline>Duration.Zero && maxBytes>0,"config","invalid model response/deadline bound")
    val base=Request[IO](Method.POST,operationUri(endpoint)).withEntity(payload.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"))
    RetrievalChecks(!credential.exists(c => c<' ' || c==127.toChar),"config","invalid model credential")
    val request=if(credential.isEmpty) base else base.putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $credential"))
    client.run(request).use { response =>
      if(!response.status.isSuccess) IO.raiseError(RetrievalError("model-http",s"model returned HTTP ${response.status.code}"))
      else response.body.take(maxBytes.toLong+1).compile.to(Array).flatMap { bytes => IO.uncancelable { _ => IO {
        RetrievalChecks(bytes.length<=maxBytes,"model-response-bound","model response byte bound exceeded")
        val text=try UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString catch { case _: Exception => throw RetrievalError("model-json","invalid model JSON") }
        io.circe.parser.parse(text).fold(_ => throw RetrievalError("model-json","invalid model JSON"),identity)
      }.flatMap(json => decode(json).handleErrorWith(error => IO.raiseError(DecoderFailure(error)))) } }
    }.timeoutTo(deadline,IO.raiseError(RetrievalError("model-timeout","model deadline exceeded"))).handleErrorWith {
      case DecoderFailure(error) => IO.raiseError(error)
      case error: RetrievalError => IO.raiseError(error)
      case _ => IO.raiseError(RetrievalError("model-transport","model transport failed"))
    }
  }
}

object EmbeddingCodec {
  def payload(model: String,text: List[String],dimensions: Int,sendDimensions: Boolean): Json = {
    val fields=List("model"->Json.fromString(model),"input"->Json.arr(text.map(Json.fromString)*),"encoding_format"->Json.fromString("float"))
    Json.obj((fields++(if(sendDimensions) List("dimensions"->Json.fromInt(dimensions)) else Nil))*)
  }
  def decode(json: Json,count: Int,dimensions: Int): List[List[Double]] = {
    def fail(detail: String): Nothing = throw RetrievalError("model-output",detail)
    val data=json.hcursor.get[List[Json]]("data").fold(_ => fail("missing embedding data"),identity)
    RetrievalChecks(data.size==count,"model-output","embedding count mismatch")
    val indexed=data.map { value =>
      val index=value.hcursor.get[Int]("index").fold(_ => fail("missing embedding index"),identity)
      val vector=value.hcursor.get[List[Double]]("embedding").fold(_ => fail("invalid embedding"),identity)
      try Vectors.validate(vector,dimensions) catch { case _: RetrievalError => fail("invalid vector dimension/value") }
      (index,vector)
    }
    RetrievalChecks(indexed.map(_._1).sorted==(0 until count).toList,"model-output","invalid embedding indices")
    indexed.sortBy(_._1).map(_._2)
  }
}

enum EmbeddingPurpose { case Document, Query }
enum ModelOutcome { case Complete, Failed, Cancelled }
/** Labels only: no URLs, owners, prompts, credentials, response bodies or vectors. */
trait EmbeddingTelemetry {
  def queued(purpose: EmbeddingPurpose): IO[Unit]
  def started(purpose: EmbeddingPurpose): IO[Unit]
  def finished(purpose: EmbeddingPurpose,outcome: ModelOutcome): IO[Unit]
}
object EmbeddingTelemetry {
  val noop: EmbeddingTelemetry = new EmbeddingTelemetry {
    def queued(purpose: EmbeddingPurpose): IO[Unit] = IO.unit
    def started(purpose: EmbeddingPurpose): IO[Unit] = IO.unit
    def finished(purpose: EmbeddingPurpose,outcome: ModelOutcome): IO[Unit] = IO.unit
  }
}
trait EmbeddingClient {
  def documents(text: List[String]): IO[List[List[Double]]]
  def query(text: String): IO[List[Double]]
}
object EmbeddingClient {
  /** Queue + running slots bounded, cancellation releases both. Deadline includes admission. */
  def resource(config: EmbeddingEndpoint,maxConcurrent: Int,maxQueued: Int,telemetry: EmbeddingTelemetry): Resource[IO,EmbeddingClient] =
    JsonHttp.client(config.deadline).evalMap(client => make(client,config,maxConcurrent,maxQueued,telemetry))
  def make(client: Client[IO],config: EmbeddingEndpoint,maxConcurrent: Int,maxQueued: Int,telemetry: EmbeddingTelemetry): IO[EmbeddingClient] = for {
    _ <- IO { config.validate(); RetrievalChecks(maxConcurrent>0 && maxQueued>=0,"config","invalid model admission limits") }
    running <- Semaphore[IO](maxConcurrent.toLong)
    admitted <- Semaphore[IO](maxConcurrent.toLong+maxQueued.toLong)
  } yield new EmbeddingClient {
    private def call(purpose: EmbeddingPurpose,text: List[String]): IO[List[List[Double]]] = IO.defer {
      val prefix=if(purpose==EmbeddingPurpose.Query) config.queryPrefix else config.documentPrefix
      val inputs=text.map(prefix+_)
      RetrievalChecks(inputs.nonEmpty && inputs.size<=config.maxBatch,"invalid","embedding batch bound")
      RetrievalChecks(inputs.forall(s => UTF_8.newEncoder().canEncode(s) && s.getBytes(UTF_8).length<=config.maxInputBytes),"invalid","embedding input bound including prefix")
      val payload=EmbeddingCodec.payload(config.model,inputs,config.dimensions,config.sendDimensions)
      RetrievalChecks(payload.noSpaces.getBytes(UTF_8).length<=config.maxRequestBytes,"invalid","embedding request byte bound")
      val admission=Resource.make(admitted.tryAcquire.flatMap(ok => if(ok) IO.unit else IO.raiseError(RetrievalError("model-busy","model admission queue full"))))(_ => admitted.release)
      admission.use { _ => telemetry.queued(purpose) *> running.permit.use { _ =>
        Resource.makeCase(telemetry.started(purpose)) { (_,exit) => telemetry.finished(purpose,exit match {
          case Resource.ExitCase.Succeeded => ModelOutcome.Complete
          case Resource.ExitCase.Errored(_) => ModelOutcome.Failed
          case Resource.ExitCase.Canceled => ModelOutcome.Cancelled
        }) }.use { _ => JsonHttp.credential(config.credentialFile).flatMap(key => JsonHttp.post(client,config.operationUrl,key,config.deadline,config.maxResponseBytes,payload)(EmbeddingCodec.decode(_,inputs.size,config.dimensions))) }
      } }.timeoutTo(config.deadline,IO.raiseError(RetrievalError("model-timeout","model deadline exceeded")))
    }
    def documents(text: List[String]): IO[List[List[Double]]] = call(EmbeddingPurpose.Document,text)
    def query(text: String): IO[List[Double]] = call(EmbeddingPurpose.Query,List(text)).map(_.head)
  }
}
