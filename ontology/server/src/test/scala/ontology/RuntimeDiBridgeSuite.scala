package ontology

import cats.effect.{Deferred, IO, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import distage.ModuleDef
import munit.FunSuite
import ponygirls.runtime.CatsIOInjector
import scala.concurrent.duration.*

final case class RuntimeDiProbe(value: Int)
final class RuntimeDiBridgeSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def use[A](resource: Resource[IO, RuntimeDiProbe])(body: RuntimeDiProbe => IO[A]): IO[A] = resource.use { probe =>
    val module = new ModuleDef { make[RuntimeDiProbe].fromValue(probe) }
    CatsIOInjector().produceGet[RuntimeDiProbe](module).use(body)
  }
  test("cancellation during gated extraction releases acquired inner resources") {
    val test = for {
      entered <- Deferred[IO, Unit]
      released <- Deferred[IO, Unit]
      unblock <- Deferred[IO, Unit]
      cancelled <- Deferred[IO, Unit]
      resource = Resource.make(IO.unit)(_ => released.complete(()).void).flatMap(_ => Resource.eval(entered.complete(()).void *> unblock.get.as(RuntimeDiProbe(1))))
      _ <- Resource.make(use(resource)(_ => IO.never[Unit]).start)(fiber => unblock.complete(()).void *> fiber.cancel).use { fiber =>
        entered.get.timeout(5.seconds) *> Resource.make((fiber.cancel *> cancelled.complete(()).void).start)(cancel => unblock.complete(()).void *> cancel.joinWithNever).use { cancel => for {
          _ <- IO.sleep(200.millis)
          before <- cancelled.tryGet
          _ <- unblock.complete(())
          _ <- cancel.joinWithNever
          _ <- released.get.timeout(5.seconds)
          _ = assert(before.nonEmpty, "cancellation waited for the gated allocation")
        } yield () }
      }
    } yield ()
    test.unsafeRunSync()(using runtime)
  }
  test("cancellation around allocation return never loses or duplicates the finalizer") {
    val Iterations = 20
    val test = (0 until Iterations).toList.traverse_ { _ => for {
      entered <- Deferred[IO, Unit]
      count <- cats.effect.Ref.of[IO, Int](0)
      resource = Resource.make(IO.pure(RuntimeDiProbe(1)))(_ => count.update(_ + 1)).evalTap(_ => entered.complete(()).void)
      _ <- Resource.make(use(resource)(_ => IO.never[Unit]).start)(_.cancel).use(fiber => entered.get *> fiber.cancel)
      released <- count.get
      _ = assertEquals(released, 1)
    } yield () }
    test.timeout(10.seconds).unsafeRunSync()(using runtime)
  }
  test("nested acquisition failure releases earlier resources exactly once") {
    val test = for {
      count <- cats.effect.Ref.of[IO, Int](0)
      resource = Resource.make(IO.unit)(_ => count.update(_ + 1)).flatMap(_ => Resource.eval(IO.raiseError[RuntimeDiProbe](new java.io.IOException("controlled acquire failure"))))
      result <- use(resource)(_ => IO.unit).attempt
      releases <- count.get
      _ = assert(result.isLeft)
      _ = assertEquals(releases, 1)
    } yield ()
    test.unsafeRunSync()(using runtime)
  }
  test("release failures remain visible and nested finalizers keep their order") {
    val test = for {
      events <- cats.effect.Ref.of[IO, List[String]](Nil)
      outer = Resource.make(IO.unit)(_ => events.update(_ :+ "outer"))
      inner = Resource.make(IO.pure(RuntimeDiProbe(1)))(_ => events.update(_ :+ "inner") *> IO.raiseError(new java.io.IOException("controlled release failure")))
      result <- use(outer.flatMap(_ => inner))(_ => IO.unit).attempt
      observed <- events.get
      _ = assert(result.isLeft)
      _ = assertEquals(observed, List("inner", "outer"))
    } yield ()
    test.unsafeRunSync()(using runtime)
  }
  test("outer Cats ownership preserves cancellation ExitCase across borrowed DI values") {
    val test = for {
      entered <- Deferred[IO, Unit]
      exit <- Deferred[IO, Resource.ExitCase]
      resource = Resource.makeCase(IO.pure(RuntimeDiProbe(1)))((_, value) => exit.complete(value).void)
      _ <- Resource.make(use(resource)(_ => entered.complete(()).void *> IO.never[Unit]).start)(_.cancel).use(fiber => entered.get *> fiber.cancel)
      observed <- exit.get
      _ = assertEquals(observed, Resource.ExitCase.Canceled)
    } yield ()
    test.unsafeRunSync()(using runtime)
  }
  test("Cats resource owns a borrowed injector value through cancellation") {
    val test = for {
      acquired <- Deferred[IO, Unit]
      released <- Deferred[IO, Unit]
      resource = Resource.make(acquired.complete(()).as(RuntimeDiProbe(7)))(_ => released.complete(()).void)
      _ <- Resource.make(use(resource)(probe => IO(assertEquals(probe.value, 7)) *> IO.never[Unit]).start)(_.cancel).use { fiber =>
        acquired.get.timeout(5.seconds) *> fiber.cancel *> released.get.timeout(5.seconds)
      }
    } yield ()
    test.unsafeRunSync()(using runtime)
  }
}
