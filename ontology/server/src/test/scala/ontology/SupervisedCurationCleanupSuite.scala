package ontology

import cats.effect.{Deferred, IO, Ref as Cell, Resource}
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import munit.FunSuite
import ontology.curation.*
import scala.concurrent.duration.*

final class SupervisedCurationCleanupSuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def run[A](value: IO[A]): A = value.unsafeRunSync()(using runtime)
  private val outcome = ScopeOutcome.Ineligible("controlled")

  test("observed cleanup results are actual results, while failures remain uncertain") { run(for {
    observer <- IO(new SupervisedCurationCleanup)
    value <- observer.observe(1.second, IO.pure(outcome), IO.raiseError(new AssertionError("unexpected budget alarm")))
    _ = assertEquals(value, CleanupObservation.Observed(outcome))
    failed <- observer.observe(1.second, IO.raiseError(new java.io.IOException("controlled failure")), IO.raiseError(new AssertionError("unexpected budget alarm")))
    _ = assertEquals(failed, CleanupObservation.Uncertain)
  } yield ()) }

  test("cleanup budget is reported while cancellation-resistant work remains owned") { run(for {
    entered <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    overdue <- Deferred[IO, Unit]
    finished <- Cell.of[IO, Boolean](false)
    returned <- Cell.of[IO, Boolean](false)
    work = entered.complete(()).void *> IO.uncancelable(_ => release.get *> finished.set(true).as(outcome))
    observation = new SupervisedCurationCleanup().observe(50.millis, work, overdue.complete(()).void).flatTap(_ => returned.set(true))
    _ <- Resource.make(observation.start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- entered.get
      _ <- overdue.get.timeout(1.second)
      pending <- finished.get
      done <- returned.get
      _ = assert(!pending && !done, "observer must neither claim completion nor detach continuing work")
      _ <- release.complete(())
      value <- fiber.joinWithNever
      _ = assertEquals(value, CleanupObservation.Observed(outcome))
      settled <- finished.get
      _ = assert(settled)
    } yield () }
  } yield ()) }

  test("a failed budget diagnostic does not cancel the owned cleanup operation") { run(for {
    entered <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    reported <- Deferred[IO, Unit]
    finished <- Cell.of[IO, Boolean](false)
    work = entered.complete(()).void *> release.get *> finished.set(true).as(outcome)
    notice = reported.complete(()).void *> IO.raiseError[Unit](new java.io.IOException("controlled diagnostic failure"))
    observer = new SupervisedCurationCleanup().observe(50.millis, work, notice).attempt
    _ <- Resource.make(observer.start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- entered.get
      _ <- reported.get.timeout(1.second)
      _ <- IO.sleep(50.millis)
      _ <- release.complete(())
      result <- fiber.joinWithNever
      settled <- finished.get
      _ = assert(settled, s"diagnostic failure cancelled the owned operation: $result")
      _ = assertEquals(result, Right(CleanupObservation.ObservedDiagnosticFailure(outcome)))
    } yield () }
  } yield ()) }

  test("combined operation and budget-diagnostic failure is distinguishable from operation failure alone") { run(for {
    release <- Deferred[IO, Unit]
    reported <- Deferred[IO, Unit]
    work = release.get *> IO.raiseError[ScopeOutcome](new java.io.IOException("controlled operation failure"))
    notice = reported.complete(()).void *> IO.raiseError[Unit](new java.io.IOException("controlled diagnostic failure"))
    _ <- Resource.make(new SupervisedCurationCleanup().observe(50.millis, work, notice).start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- reported.get.timeout(1.second)
      _ <- release.complete(())
      observed <- fiber.joinWithNever
      _ = assertEquals(observed, CleanupObservation.UncertainDiagnosticFailure)
    } yield () }
  } yield ()) }

  test("cancellation joins owned cleanup rather than abandoning it") { run(for {
    entered <- Deferred[IO, Unit]
    release <- Deferred[IO, Unit]
    finished <- Cell.of[IO, Boolean](false)
    cancelled <- Cell.of[IO, Boolean](false)
    work = entered.complete(()).void *> IO.uncancelable(_ => release.get *> finished.set(true).as(outcome))
    _ <- Resource.make(new SupervisedCurationCleanup().observe(1.second, work, IO.unit).start)(fiber => release.complete(()).void *> fiber.cancel).use { fiber => for {
      _ <- entered.get
      cancelling <- fiber.cancel.flatTap(_ => cancelled.set(true)).start
      _ <- IO.sleep(50.millis)
      early <- cancelled.get
      _ = assert(!early, "cancellation cannot claim a cancellation-resistant operation has stopped")
      _ <- release.complete(())
      _ <- cancelling.joinWithNever
      settled <- finished.get
      _ = assert(settled)
    } yield () }
  } yield ()) }
}
