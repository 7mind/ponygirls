package ontology.curation

import cats.effect.{Deferred, FiberIO, IO, Ref as Cell, Resource}
import cats.effect.kernel.Outcome
import cats.syntax.all.*
import java.util.UUID
import ontology.*
import ontology.api.*
import ontology.domain.{Fault, Require}
import scala.concurrent.duration.*

final case class CurationRunnerConfig(pollEvery: FiniteDuration, renewEvery: FiniteDuration, cleanupBudget: FiniteDuration) {
  Require(pollEvery > Duration.Zero && renewEvery > Duration.Zero && cleanupBudget > Duration.Zero, "config", "positive runner intervals required")
}
enum RunnerCleanupStage { case Work, Renewal, Release }
enum RunnerEvent {
  case AcquisitionUncertain
  case ResourcesReady(instance: ProjectionInstance)
  case CleanupOverBudget(stage: RunnerCleanupStage)
  case CleanupUncertain(stage: RunnerCleanupStage)
  case CleanupDiagnosticFailure(stage: RunnerCleanupStage)
}
final case class CurationRunResult(reason: CycleStop, stopped: Option[CycleStop])
trait CurationRunnerDiagnostics { def emit(event: RunnerEvent): IO[Unit] }

final class CurationRunner(repo: CurationRepository, settings: CurationStoreSettings, cycleConfig: CurationCycleConfig,
  config: CurationRunnerConfig, ownerIds: IO[UUID], freshKernel: CurationCycleConfig => IO[CurationCoordinator],
  cleanup: CurationCleanup, diagnostics: CurationRunnerDiagnostics, projection: ProjectionFactory,
  child: ProjectionAttachment => Resource[IO, Unit]) {
  private val renewalDuration = java.time.Duration.of(config.renewEvery.length, config.renewEvery.unit.toChronoUnit)
  Require(renewalDuration.compareTo(settings.leaseDuration) < 0 && cycleConfig.scanLimit <= settings.maxScanScopes &&
    cycleConfig.recoveryLimit <= settings.maxRecoveryAttempts, "config", "runner intervals or cycle bounds exceed store contract")
  private def report(kernel: CurationCoordinator, event: RunnerEvent): IO[Unit] = diagnostics.emit(event).handleErrorWith(_ =>
    kernel.diagnosticFailure *> IO.raiseError(Fault("curation-diagnostic", "lifecycle diagnostic failed")))
  private def uncertainty(code: String, detail: String, diagnosticFailed: Boolean): Fault = {
    val error = Fault(code, detail)
    if (diagnosticFailed) error.addSuppressed(Fault("curation-diagnostic", "lifecycle diagnostic also failed"))
    error
  }
  private def unconfirmed(kernel: CurationCoordinator, stage: RunnerCleanupStage, diagnosticFailed: Boolean): IO[Unit] =
    kernel.halt(CycleStop.CleanupUncertain) *> report(kernel, RunnerEvent.CleanupUncertain(stage)).attempt.flatMap { reported =>
      kernel.stopped.flatMap(reason => IO.raiseError(uncertainty("curation-" + stage.toString.toLowerCase(java.util.Locale.ROOT) + "-uncertain",
        "owned lifecycle cleanup was not confirmed", diagnosticFailed || reported.isLeft || reason.contains(CycleStop.DiagnosticFailure))))
    }
  private def settle(kernel: CurationCoordinator, stage: RunnerCleanupStage, work: IO[Unit]): IO[Unit] =
    cleanup.observe(config.cleanupBudget, work, kernel.halt(CycleStop.CleanupOverBudget) *> report(kernel, RunnerEvent.CleanupOverBudget(stage))).attempt.flatMap {
      case Right(CleanupObservation.Observed(_)) => IO.unit
      case Right(CleanupObservation.ObservedDiagnosticFailure(_)) => kernel.diagnosticFailure *>
        IO.raiseError(Fault("curation-diagnostic", "owned cleanup completed but its budget diagnostic failed"))
      case Right(CleanupObservation.UncertainDiagnosticFailure) => kernel.diagnosticFailure *> unconfirmed(kernel, stage, true)
      case _ => unconfirmed(kernel, stage, false)
    }
  private def cancelJoin[A](fiber: FiberIO[A], diagnosticClose: IO[Boolean]): IO[Unit] = IO.uncancelable { _ =>
    fiber.cancel.attempt.flatMap { cancelled => fiber.join.attempt.flatMap { joined => diagnosticClose.flatMap { known =>
      def onlyDiagnostic(error: Throwable): Boolean = known && (error match {
        case fault: Fault => fault.code == "curation-diagnostic"
        case _ => false
      })
      val failures = cancelled.left.toOption.filterNot(onlyDiagnostic).map(_ => Fault("curation-cancel-uncertain", "owned fiber cancellation failed")).toList ++ (joined match {
        case Left(_) => List(Fault("curation-join-uncertain", "owned fiber join failed"))
        case Right(Outcome.Errored(error)) if onlyDiagnostic(error) => Nil
        case Right(Outcome.Errored(_)) => List(Fault("curation-worker-error", "owned fiber ended with an error"))
        case _ => Nil
      })
      if (failures.isEmpty) IO.unit else IO {
        val error = Fault("curation-fiber-uncertain", "owned fiber did not settle successfully")
        failures.foreach(error.addSuppressed)
        throw error
      }
    } } }
  }
  private def closed(kernel: CurationCoordinator, attached: Cell[IO, Boolean], evidence: Cell[IO, Option[CleanupObservation[Unit]]]): IO[Unit] =
    (attached.get, evidence.get).tupled.flatMap {
      case (_, Some(CleanupObservation.Observed(_))) | (false, None) => IO.unit
      case (_, Some(CleanupObservation.ObservedDiagnosticFailure(_))) => kernel.diagnosticFailure
      case (_, Some(CleanupObservation.UncertainDiagnosticFailure)) => kernel.diagnosticFailure *> IO.raiseError(Fault("projection-close-uncertain", "RDF closure and diagnostics were not confirmed"))
      case _ => IO.raiseError(Fault("projection-close-uncertain", "RDF closure was not confirmed"))
    }
  private def joinWork(kernel: CurationCoordinator, worker: FiberIO[CycleStop], attached: Cell[IO, Boolean], evidence: Cell[IO, Option[CleanupObservation[Unit]]], childFailed: Cell[IO, Boolean]): IO[Unit] =
    (cancelJoin(worker, (evidence.get, childFailed.get).mapN { (observed, failed) => !failed && observed.exists {
      case CleanupObservation.Observed(_) | CleanupObservation.ObservedDiagnosticFailure(_) => true
      case _ => false
    } }).attempt,
      closed(kernel, attached, evidence).attempt, childFailed.get).tupled.flatMap { case (joined, resource, failed) =>
      val errors = List(joined, resource).flatMap(_.left.toOption) ++ (if (failed) List(Fault("curation-child-uncertain", "child resource acquisition or cleanup failed")) else Nil)
      if (errors.isEmpty) IO.unit else IO {
        val error = Fault("curation-work-uncertain", "owned worker or resource cleanup was not confirmed")
        errors.foreach(error.addSuppressed)
        throw error
      }
    }
  private def closeDiagnostic(kernel: CurationCoordinator, evidence: Cell[IO, Option[CleanupObservation[Unit]]]): IO[Unit] = evidence.get.flatMap {
    case Some(CleanupObservation.ObservedDiagnosticFailure(_)) => kernel.diagnosticFailure *>
      report(kernel, RunnerEvent.CleanupDiagnosticFailure(RunnerCleanupStage.Work)).attempt *>
      IO.raiseError(Fault("curation-diagnostic", "owned RDF close completed but its diagnostic failed"))
    case _ => IO.unit
  }
  private def renew(kernel: CurationCoordinator, fence: CoordinatorFence, signal: Deferred[IO, CycleStop]): IO[Unit] = IO.defer {
    IO.sleep(config.renewEvery) *> IO.defer(repo.renew(fence)).attempt.flatMap {
      case Right(value) if value.fence == fence => renew(kernel, fence, signal)
      case _ => kernel.halt(CycleStop.OwnershipLost) *> signal.complete(CycleStop.OwnershipLost).void *> kernel.stopAdmissions(CycleStop.OwnershipLost)
    }
  }
  private def work(kernel: CurationCoordinator, fence: CoordinatorFence, projection: ProjectionStep): IO[CycleStop] = IO.defer {
    kernel.stopped.flatMap {
      case Some(reason) => IO.pure(reason)
      case None => projection.advance.flatMap { before => before.stopped match {
        case Some(reason) => IO.pure(reason)
        case None if !before.reconciliationComplete => IO.sleep(config.pollEvery) *> work(kernel, fence, projection)
        case None => kernel.cycle(fence).flatMap { report => report.stopped match {
          case Some(reason) => IO.pure(reason)
          case None => projection.advance.flatMap { after => after.stopped match {
            case Some(reason) => IO.pure(reason)
            case None => IO.sleep(config.pollEvery) *> work(kernel, fence, projection)
          } }
        } }
      } }
    }
  }
  def run: IO[CurationRunResult] = for {
    owner <- ownerIds
    kernel <- freshKernel(cycleConfig)
    previous <- kernel.stopped
    _ <- IO(Require(previous.isEmpty, "config", "runner requires a fresh kernel"))
    signal <- Deferred[IO, CycleStop]
    attached <- Cell.of[IO, Boolean](false)
    childFailed <- Cell.of[IO, Boolean](false)
    closure <- Cell.of[IO, Option[CleanupObservation[Unit]]](None)
    control = new ProjectionResourceControl {
      def stopped: IO[Option[CycleStop]] = kernel.stopped
      def halt(reason: CycleStop): IO[Unit] = kernel.halt(reason) *> signal.complete(reason).void
      def diagnosticFailure: IO[Unit] = kernel.diagnosticFailure *> signal.complete(CycleStop.DiagnosticFailure).void
      def resourceClosed(value: CleanupObservation[Unit]): IO[Unit] = closure.modify {
        case None => (Some(value), true)
        case found => (found, false)
      }.flatMap(first => IO(Require(first, "projection-close-uncertain", "duplicate RDF close observation")))
    }
    accepting = kernel.stopped.flatMap(value => IO(Require(value.isEmpty, "coordinator-stopped", "resource admission stopped")))
    reason <- Resource.make(
      IO.defer(repo.acquire(owner)).flatMap { lease =>
        IO(Require(lease.fence.ownerId == owner && lease.fence.epoch > 0, "coordinator-result", "acquisition acknowledgment differs from owner")).as(lease)
      }.handleErrorWith(_ => kernel.halt(CycleStop.OwnershipLost) *> report(kernel, RunnerEvent.AcquisitionUncertain).attempt.flatMap { reported =>
        IO.raiseError(uncertainty("curation-acquire-uncertain", "coordinator acquisition was not confirmed", reported.isLeft))
      })
    )(lease => settle(kernel, RunnerCleanupStage.Release, IO.defer(repo.release(lease.fence)))).use { lease =>
      Resource.make(renew(kernel, lease.fence, signal).start)(fiber => settle(kernel, RunnerCleanupStage.Renewal, cancelJoin(fiber, IO.pure(false)))).flatMap { _ =>
        val worker = IO.defer {
          (Resource.eval(accepting) *> projection.open(lease.fence, control)).flatMap { value =>
            val observedChild = child(value).mapK(new cats.arrow.FunctionK[IO, IO] {
              def apply[A](work: IO[A]): IO[A] = work.onError { case _ => childFailed.set(true) }
            })
            Resource.eval(attached.set(true) *> accepting) *> observedChild.evalTap(_ => accepting *> report(kernel, RunnerEvent.ResourcesReady(value.rdf.instance))).as(value)
          }.use(value => work(kernel, lease.fence, value.step))
        }
        Resource.make(worker.start) { fiber =>
          kernel.halt(CycleStop.Cancelled) *> settle(kernel, RunnerCleanupStage.Work, joinWork(kernel, fiber, attached, closure, childFailed)) *> closeDiagnostic(kernel, closure)
        }
      }.use { worker => IO.race(worker.join, signal.get).flatMap {
        case Right(reason) => IO.pure(reason)
        case Left(Outcome.Succeeded(value)) => value
        case Left(Outcome.Errored(_)) => kernel.stopped.flatMap {
          case Some(reason) => IO.pure(reason)
          case None => kernel.halt(CycleStop.StoreUncertain).as(CycleStop.StoreUncertain)
        }
        case Left(Outcome.Canceled()) => kernel.halt(CycleStop.Cancelled).as(CycleStop.Cancelled)
      } }
    }
    stopped <- kernel.stopped
  } yield CurationRunResult(reason, stopped)
}
