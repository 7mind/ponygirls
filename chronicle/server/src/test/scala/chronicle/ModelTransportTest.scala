package chronicle
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import org.http4s.{Message as _,*}
import org.http4s.ember.server.EmberServerBuilder
import com.comcast.ip4s.*
import io.circe.Json
import scala.concurrent.duration.*
class ModelTransportTest extends munit.FunSuite {
  override val munitTimeout = 180.seconds
  private def run(config: Config,app: HttpApp[IO],check: (ModelHttp,String) => IO[Unit]): Unit = {
    (for {
      server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withIdleTimeout(120.seconds).withHttpApp(app).build
      client <- ModelHttp.client(config)
    } yield (server,client)).use { case (server,client) =>
      check(new ModelHttp(client),s"http://127.0.0.1:${server.address.getPort}/model")
    }.unsafeRunSync()
  }
  private def configured(): Config = {
    val config=Fixtures.config()
    config.copy(annotation=config.annotation.copy(timeoutSeconds=100),embedding=config.embedding.copy(timeoutSeconds=1))
  }
  test("Blackbox-GoodCommunication regression: configured deadline permits headers after Ember default idle timeout") {
    val config=configured()
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.sleep(65.seconds).as(Response[IO](Status.Ok).withEntity("{}")))
    run(config,app,(http,url) => http.post(url,config.annotation.credentialFile,config.annotation.timeoutSeconds,1024,Json.obj()).map(json => assertEquals(json,Json.obj())))
  }
  test("Blackbox-GoodCommunication regression: configured deadline permits body gap after Ember default idle timeout") {
    val config=configured()
    val body=fs2.Stream.emit('{'.toByte).covary[IO] ++ fs2.Stream.sleep_[IO](65.seconds) ++ fs2.Stream.emit('}'.toByte).covary[IO]
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withBodyStream(body)))
    run(config,app,(http,url) => http.post(url,config.annotation.credentialFile,config.annotation.timeoutSeconds,1024,Json.obj()).map(json => assertEquals(json,Json.obj())))
  }
  test("Blackbox-GoodCommunication: shorter embedding whole-request deadline remains enforced") {
    val config=configured()
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.sleep(3.seconds).as(Response[IO](Status.Ok).withEntity("{}")))
    run(config,app,(http,url) => http.post(url,config.embedding.credentialFile,config.embedding.timeoutSeconds,1024,Json.obj()).attempt.map {
      case Left(error: DomainError) => assertEquals(error.code,"model-timeout")
      case result => fail(s"expected model-timeout, got $result")
    })
  }
  test("Blackbox-GoodCommunication: whole-request deadline includes body even with continuous transport progress") {
    val config=configured()
    val body=fs2.Stream.emit('{'.toByte).covary[IO] ++ fs2.Stream.awakeEvery[IO](200.millis).as(' '.toByte)
    val app: HttpApp[IO]=cats.data.Kleisli(_ => IO.pure(Response[IO](Status.Ok).withBodyStream(body)))
    run(config,app,(http,url) => http.post(url,config.annotation.credentialFile,1,1024,Json.obj()).attempt.map {
      case Left(error: DomainError) => assertEquals(error.code,"model-timeout")
      case result => fail(s"expected model-timeout, got $result")
    })
  }
}
