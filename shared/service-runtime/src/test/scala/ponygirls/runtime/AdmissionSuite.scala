package ponygirls.runtime

import cats.effect.{Deferred, IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import munit.FunSuite
import scala.concurrent.duration.*

// Behavioral/Active/Blackbox/Atomic. Specified lifecycle and overload contract.
final class AdmissionSuite extends FunSuite {
  private def run[A](io: IO[A]): A = io.timeout(10.seconds).unsafeRunSync()

  test("active bound, finite queue, cancellation frees reservation") {
    run(Admission.resource(AdmissionConfig(1, 1, 2.seconds)).use { gate => for {
      started <- Deferred[IO, Unit]
      finish <- Deferred[IO, Unit]
      active <- gate.run(started.complete(()) *> finish.get).start
      _ <- started.get
      waiting <- gate.run(IO.unit).start
      _ <- IO.sleep(50.millis)
      full <- gate.run(IO.unit).attempt
      _ <- IO(assertEquals(full, Left(RuntimeFailure("admission-full"))))
      _ <- waiting.cancel
      _ <- finish.complete(())
      _ <- active.joinWithNever
      _ <- gate.run(IO.unit)
    } yield () })
  }

  test("waiting deadline frees reservation and does not execute callback") {
    run(Admission.resource(AdmissionConfig(1, 1, 100.millis)).use { gate => for {
      started <- Deferred[IO, Unit]
      finish <- Deferred[IO, Unit]
      entered <- Deferred[IO, Unit]
      active <- gate.run(started.complete(()) *> finish.get).start
      _ <- started.get
      expired <- gate.run(entered.complete(()).void).attempt
      _ <- IO(assertEquals(expired, Left(RuntimeFailure("admission-timeout"))))
      ran <- entered.tryGet
      _ <- IO(assertEquals(ran, None))
      _ <- finish.complete(())
      _ <- active.joinWithNever
      _ <- gate.run(IO.unit)
    } yield () })
  }

  test("closing waits for work, rejects new work, releases after errors") {
    run(for {
      allocated <- Admission.resource(AdmissionConfig(1, 1, 1.second)).allocated
      (gate, close) = allocated
      _ <- gate.run(IO.raiseError[Unit](new IllegalStateException("domain"))).attempt
      started <- Deferred[IO, Unit]
      finish <- Deferred[IO, Unit]
      closed <- Deferred[IO, Unit]
      active <- gate.run(started.complete(()) *> finish.get).start
      _ <- started.get
      closing <- (close *> closed.complete(())).start
      _ <- IO.sleep(50.millis)
      status <- closed.tryGet
      _ <- IO(assertEquals(status, None))
      rejected <- gate.run(IO.unit).attempt
      _ <- IO(assertEquals(rejected, Left(RuntimeFailure("runtime-closed"))))
      _ <- finish.complete(())
      _ <- active.joinWithNever
      _ <- closing.joinWithNever
      after <- gate.run(IO.unit).attempt
      _ <- IO(assertEquals(after, Left(RuntimeFailure("runtime-closed"))))
    } yield ())
  }

  test("zero-queue admission rejects while busy; cancellation of work releases permit") {
    run(Admission.resource(AdmissionConfig(1, 0, 1.second)).use { gate => for {
      entered <- Deferred[IO, Unit]
      fiber <- gate.run(entered.complete(()) *> IO.never[Unit]).start
      _ <- entered.get
      full <- gate.run(IO.unit).attempt
      _ <- IO(assertEquals(full, Left(RuntimeFailure("admission-full"))))
      _ <- fiber.cancel
      _ <- gate.run(IO.unit)
    } yield () })
  }

  test("invalid unbounded capacities and durations fail") {
    intercept[IllegalArgumentException](AdmissionConfig(0, 1, 1.second).validate())
    intercept[IllegalArgumentException](AdmissionConfig(1, -1, 1.second).validate())
    intercept[IllegalArgumentException](AdmissionConfig(1, 1, Duration.Zero).validate())
    intercept[IllegalArgumentException](AdmissionConfig(1, 1, 1.hour).validate())
  }
}
