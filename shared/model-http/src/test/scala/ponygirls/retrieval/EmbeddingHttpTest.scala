package ponygirls.retrieval

import cats.effect.{Deferred,IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.*
import org.http4s.client.Client
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.*
import io.circe.Json
import java.nio.file.Files
import scala.concurrent.duration.*

class EmbeddingHttpTest extends munit.FunSuite {
  override val munitTimeout = 30.seconds
  private val emptyCredential=Files.createTempFile("controlled-model-empty-credential",".txt")
  override def afterAll(): Unit = { Files.deleteIfExists(emptyCredential); () }
  private val reply="""{"data":[{"index":0,"embedding":[1,0,0]}]}"""
  private def config(url: String): EmbeddingEndpoint = EmbeddingEndpoint(url,"controlled","immutable-v1",3,false,"doc:","query:","cosine",emptyCredential.toString,3.seconds,65536,16,16384,262144)
  private def server(app: HttpApp[IO]): Resource[IO,(Client[IO],String)] = for {
    s <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
    c <- JsonHttp.client(5.seconds)
  } yield (c,s"http://127.0.0.1:${s.address.getPort}/full/operation?fixed=true")
  private def response(text: String): HttpApp[IO] = cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withEntity(text)))
  private def query(body: String,cfg: EmbeddingEndpoint => EmbeddingEndpoint): Either[Throwable,List[Double]] = server(response(body)).use { (http,url) =>
    EmbeddingClient.make(http,cfg(config(url)),1,1,EmbeddingTelemetry.noop).flatMap(_.query("fixture")).attempt
  }.unsafeRunSync()
  test("Blackbox-GoodCommunication: explicit full URL, prefixes, model, dimension option and response order") {
    List(false,true).foreach { send =>
      val app: HttpApp[IO]=cats.data.Kleisli { request => request.as[String].map { raw =>
        val json=io.circe.parser.parse(raw).toOption.get
        assertEquals(request.uri.path.renderString,"/full/operation")
        assertEquals(request.uri.query.params.get("fixed"),Some("true"))
        assertEquals(request.headers.get(org.typelevel.ci.CIString("Authorization")),None)
        assertEquals(json.hcursor.get[String]("model").toOption,Some("controlled"))
        assertEquals(json.hcursor.get[List[String]]("input").toOption,Some(List("doc:first","doc:second")))
        assertEquals(json.hcursor.get[Int]("dimensions").toOption,if(send) Some(3) else None)
        Response[IO](Status.Ok).withEntity("""{"data":[{"index":1,"embedding":[0,1,0]},{"index":0,"embedding":[1,0,0]}]}""")
      } }
      server(app).use { (http,url) => EmbeddingClient.make(http,config(url).copy(sendDimensions=send),1,0,EmbeddingTelemetry.noop).flatMap(_.documents(List("first","second"))).map(values => assertEquals(values,List(List(1.0,0.0,0.0),List(0.0,1.0,0.0)))) }.unsafeRunSync()
    }
  }
  List(
    "missing data"->"{}",
    "wrong count"->"""{"data":[]}""",
    "wrong index"->"""{"data":[{"index":1,"embedding":[1,0,0]}]}""",
    "missing index"->"""{"data":[{"embedding":[1,0,0]}]}""",
    "wrong dimensions"->"""{"data":[{"index":0,"embedding":[1,0]}]}""",
    "zero"->"""{"data":[{"index":0,"embedding":[0,0,0]}]}""",
    "null"->"""{"data":[{"index":0,"embedding":[null,0,0]}]}""",
    "float overflow"->"""{"data":[{"index":0,"embedding":[1e100,0,0]}]}""",
    "float underflow"->"""{"data":[{"index":0,"embedding":[1e-200,0,0]}]}""",
    "malformed JSON"->"not json"
  ).foreach { (name,body) => test(s"Blackbox-GoodCommunication: rejects $name without fallback") { assert(query(body,identity).isLeft) } }
  test("Blackbox-GoodCommunication: duplicate indexes rejected, no implicit truncation") {
    val body="""{"data":[{"index":0,"embedding":[1,0,0]},{"index":0,"embedding":[1,0,0]}]}"""
    server(response(body)).use { (http,url) => EmbeddingClient.make(http,config(url),1,0,EmbeddingTelemetry.noop).flatMap(_.documents(List("one","two"))).attempt.map(r => assert(r.isLeft)) }.unsafeRunSync()
  }
  test("Blackbox-GoodCommunication: body bound and HTTP status never expose provider body") {
    assertEquals(query(reply,c => c.copy(maxResponseBytes=5)).left.toOption.get.asInstanceOf[RetrievalError].code,"model-response-bound")
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.TooManyRequests).withEntity("secret fixture provider body")))
    server(app).use { (http,url) => EmbeddingClient.make(http,config(url),1,0,EmbeddingTelemetry.noop).flatMap(_.query("fixture")).attempt.map { result =>
      val error=result.left.toOption.get
      assertEquals(error.getMessage,"model returned HTTP 429")
      assert(!error.toString.contains("secret"))
    } }.unsafeRunSync()
  }
  test("Blackbox-GoodCommunication: whole-call deadline includes body progress") {
    val body=fs2.Stream.emit('{'.toByte).covary[IO]++fs2.Stream.awakeEvery[IO](20.millis).as(' '.toByte)
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withBodyStream(body)))
    server(app).use { (http,url) => EmbeddingClient.make(http,config(url).copy(deadline=150.millis),1,0,EmbeddingTelemetry.noop).flatMap(_.query("fixture")).attempt.map(r => assertEquals(r.left.toOption.get.asInstanceOf[RetrievalError].code,"model-timeout")) }.unsafeRunSync()
  }
  test("Blackbox-GoodCommunication: explicit credential file only; secrets never in descriptors/errors") {
    val path=Files.createTempFile("controlled-embedding-credential",".txt")
    try {
      Files.writeString(path,"fixture-bearer-secret\n")
      val app: HttpApp[IO]=cats.data.Kleisli { request => IO {
        assertEquals(request.headers.get(org.typelevel.ci.CIString("Authorization")).map(_.head.value),Some("Bearer fixture-bearer-secret"))
        Response[IO](Status.Ok).withEntity(reply)
      } }
      server(app).use { (http,url) =>
        val cfg=config(url).copy(credentialFile=path.toString)
        assert(!cfg.space.json.noSpaces.contains("secret")); assert(!cfg.space.json.noSpaces.contains(path.toString))
        EmbeddingClient.make(http,cfg,1,0,EmbeddingTelemetry.noop).flatMap(_.query("fixture")).void *>
          EmbeddingClient.make(http,cfg.copy(credentialFile=path.toString+"-absent"),1,0,EmbeddingTelemetry.noop).flatMap(_.query("fixture")).attempt.map { r =>
            val error=r.left.toOption.get
            assertEquals(error.getMessage,"model credential file unavailable")
            assert(!error.toString.contains(path.toString))
          }
      }.unsafeRunSync()
    } finally Files.delete(path)
  }
  test("Blackbox-GoodCommunication: input/body/batch bounds reject before provider call") {
    val calls=new java.util.concurrent.atomic.AtomicInteger()
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO { calls.incrementAndGet(); Response[IO](Status.Ok).withEntity(reply) })
    server(app).use { (http,url) => EmbeddingClient.make(http,config(url).copy(maxInputBytes=8,maxBatch=1,maxRequestBytes=100),1,0,EmbeddingTelemetry.noop).flatMap { client =>
      client.query("long fixture").attempt.flatMap(r => IO(assert(r.isLeft))) *>
        client.documents(List("a","b")).attempt.flatMap(r => IO(assert(r.isLeft))) *>
        IO(assertEquals(calls.get(),0))
    } }.unsafeRunSync()
  }
  test("Blackbox-GoodCommunication: bounded admission, queued cancellation and running cancellation release capacity") {
    (for {
      hold <- Deferred[IO,Unit]
      entered <- Deferred[IO,Unit]
      twoQueued <- Deferred[IO,Unit]
      queueCount <- Ref.of[IO,Int](0)
      events <- Ref.of[IO,List[ModelOutcome]](Nil)
      telemetry = new EmbeddingTelemetry {
        def queued(p: EmbeddingPurpose): IO[Unit] = queueCount.updateAndGet(_+1).flatMap(n => if(n>=2) twoQueued.complete(()).void else IO.unit)
        def started(p: EmbeddingPurpose): IO[Unit] = IO.unit
        def finished(p: EmbeddingPurpose,o: ModelOutcome): IO[Unit] = events.update(_:+o)
      }
      app: HttpApp[IO] = cats.data.Kleisli(_ => entered.complete(()).void *> hold.get.as(Response[IO](Status.Ok).withEntity(reply)))
      _ <- server(app).use { (http,url) => for {
        client <- EmbeddingClient.make(http,config(url),1,1,telemetry)
        first <- client.query("one").start
        _ <- entered.get
        queued <- client.query("two").start
        _ <- twoQueued.get
        busy <- client.query("three").attempt
        _ <- IO(assertEquals(busy.left.toOption.get.asInstanceOf[RetrievalError].code,"model-busy"))
        _ <- queued.cancel
        _ <- first.cancel
        _ <- hold.complete(())
        next <- client.query("next")
        _ <- IO(assertEquals(next,List(1.0,0.0,0.0)))
        outcomes <- events.get
        _ <- IO { assert(outcomes.contains(ModelOutcome.Cancelled)); assert(outcomes.contains(ModelOutcome.Complete)) }
      } yield () }
    } yield ()).unsafeRunSync()
  }
  test("BA: URL/revision/dimensions/normalization are explicit validated config") {
    List("relative","file:///tmp/model","http://user:secret@localhost/model","http://localhost/model#fragment").foreach { url => intercept[RetrievalError](config(url).validate()) }
    intercept[RetrievalError](config("http://127.0.0.1/model").copy(revision="").validate())
    intercept[RetrievalError](config("http://127.0.0.1/model").copy(dimensions=4001).validate())
  }
  test("Blackbox-GoodCommunication: controlled connection refusal has safe diagnostics without URL/payload/credential path") {
    val cfg=config("http://127.0.0.1:1/model?token=controlled-secret")
    val result=JsonHttp.client(1.second).use { http => EmbeddingClient.make(http,cfg,1,0,EmbeddingTelemetry.noop).flatMap(_.query("controlled private input")).attempt }.unsafeRunSync()
    val error=result.left.toOption.get
    assertEquals(error.getMessage,"model transport failed")
    assertEquals(error.getCause,null)
    assert(!error.toString.contains("controlled"))
    assertEquals(cfg.toString,"EmbeddingEndpoint(<redacted>)")
  }

}
