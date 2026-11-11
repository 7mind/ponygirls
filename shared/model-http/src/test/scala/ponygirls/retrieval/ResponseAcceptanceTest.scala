package ponygirls.retrieval

import cats.effect.{IO, Ref, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import io.circe.Json
import org.http4s.{Response, Status}
import org.http4s.client.Client
import scala.concurrent.duration.*

final class ResponseAcceptanceTest extends munit.FunSuite {
  override val munitTimeout = 10.seconds
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def run[A](effect: IO[A]): A = effect.unsafeRunSync()(using runtime)
  private type Post = (Client[IO], FiniteDuration, Json => IO[String]) => IO[String]
  private val accounting: Post = (client, deadline, accept) => JsonHttp.postF(client, "http://127.0.0.1/fixture", "", deadline, 1024, Json.obj())(accept)
  private val cancellable: Post = (client, deadline, accept) => JsonHttp.postCancelableF(client, "http://127.0.0.1/fixture", "", deadline, 1024, Json.obj())(accept)

  List(("accounting", accounting, true), ("cancellable", cancellable, false)).foreach { (name, post, expectedAudit) =>
    test(s"$name callback policy preserves its declared deadline/acceptance behavior") { run(for {
      entered <- Ref.of[IO, Boolean](false)
      accepted <- Ref.of[IO, Boolean](false)
      released <- Ref.of[IO, Boolean](false)
      client = Client[IO](_ => Resource.make(IO.pure(Response[IO](Status.Ok).withEntity("{}")))(_ => released.set(true)))
      result <- post(client, 100.millis, _ => entered.set(true) *> IO.sleep(300.millis) *> accepted.set(true).as("candidate")).attempt
      didEnter <- entered.get; didAccept <- accepted.get; didRelease <- released.get
      _ = assert(didEnter, "The fixture must enter the callback before timeout")
      _ = assertEquals(didAccept, expectedAudit)
      _ = assert(didRelease)
      _ = if (expectedAudit) assertEquals(result, Right("candidate"))
          else assertEquals(result.left.toOption.collect { case error: RetrievalError => error.code }, Some("model-timeout"))
    } yield ()) }
    test(s"$name response capture precedes release failure without publishing success") { run(for {
      accepted <- Ref.of[IO, Boolean](false)
      released <- Ref.of[IO, Boolean](false)
      client = Client[IO](_ => Resource.make(IO.pure(Response[IO](Status.Ok).withEntity("{}")))(_ => released.set(true) *> IO.raiseError(new RuntimeException("fixture release detail"))))
      result <- post(client, 3.seconds, _ => accepted.set(true).as("candidate")).attempt
      didAccept <- accepted.get; didRelease <- released.get
      _ = assert(didAccept && didRelease)
      _ = assertEquals(result.left.toOption.collect { case error: RetrievalError => error.code }, Some("model-transport"))
      _ = assert(!result.left.toOption.get.toString.contains("fixture release detail"))
    } yield ()) }
  }
}
