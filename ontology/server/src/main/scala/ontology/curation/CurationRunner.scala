package ontology.curation

import cats.effect.{Deferred, FiberIO, IO, Resource}
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
  case CleanupOverBudget(stage: RunnerCleanupStage)
  case CleanupUncertain(stage: RunnerCleanupStage)
}
final case class CurationRunResult(reason: CycleStop, stopped: Option[CycleStop])
trait CurationRunnerDiagnostics { def emit(event: RunnerEvent): IO[Unit] }

final class CurationRunner(repo: CurationRepository, settings: CurationStoreSettings, cycleConfig: CurationCycleConfig,
  config: CurationRunnerConfig, ownerIds: IO[UUID], freshKernel: CurationCycleConfig => IO[CurationCoordinator],
  cleanup: CurationCleanup, diagnostics: CurationRunnerDiagnostics) {
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
      IO.raiseError(uncertainty("curation-" + stage.toString.toLowerCase(java.util.Locale.ROOT) + "-uncertain", "owned lifecycle cleanup was not confirmed", diagnosticFailed || reported.isLeft))
    }
  private def settle(kernel: CurationCoordinator, stage: RunnerCleanupStage, work: IO[Unit]): IO[Unit] =
    cleanup.observe(config.cleanupBudget, work, kernel.halt(CycleStop.CleanupOverBudget) *> report(kernel, RunnerEvent.CleanupOverBudget(stage))).attempt.flatMap {
      case Right(CleanupObservation.Observed(_)) => IO.unit
      case Right(CleanupObservation.ObservedDiagnosticFailure(_)) => kernel.diagnosticFailure *>
        IO.raiseError(Fault("curation-diagnostic", "owned cleanup completed but its budget diagnostic failed"))
      case Right(CleanupObservation.UncertainDiagnosticFailure) => kernel.diagnosticFailure *> unconfirmed(kernel, stage, true)
      case _ => unconfirmed(kernel, stage, false)
    }
  private def cancelJoin[A](fiber: FiberIO[A]): IO[Unit] = fiber.cancel.guarantee(fiber.join.void)
  private def renew(kernel: CurationCoordinator, fence: CoordinatorFence, signal: Deferred[IO, CycleStop]): IO[Unit] = IO.defer {
    IO.sleep(config.renewEvery) *> IO.defer(repo.renew(fence)).attempt.flatMap {
      case Right(value) if value.fence == fence => renew(kernel, fence, signal)
      case _ => kernel.halt(CycleStop.OwnershipLost) *> signal.complete(CycleStop.OwnershipLost).void *> kernel.stopAdmissions(CycleStop.OwnershipLost)
    }
  }
  private def work(kernel: CurationCoordinator, fence: CoordinatorFence): IO[CycleStop] = IO.defer {
    kernel.cycle(fence).flatMap { report => report.stopped match {
      case Some(reason) => IO.pure(reason)
      case None => IO.sleep(config.pollEvery) *> work(kernel, fence)
    } }
  }
  def run: IO[CurationRunResult] = for {
    owner <- ownerIds
    kernel <- freshKernel(cycleConfig)
    previous <- kernel.stopped
    _ <- IO(Require(previous.isEmpty, "config", "runner requires a fresh kernel"))
    signal <- Deferred[IO, CycleStop]
    reason <- Resource.make(
      IO.defer(repo.acquire(owner)).flatMap { lease =>
        IO(Require(lease.fence.ownerId == owner && lease.fence.epoch > 0, "coordinator-result", "acquisition acknowledgment differs from owner")).as(lease)
      }.handleErrorWith(_ => kernel.halt(CycleStop.OwnershipLost) *> report(kernel, RunnerEvent.AcquisitionUncertain).attempt.flatMap { reported =>
        IO.raiseError(uncertainty("curation-acquire-uncertain", "coordinator acquisition was not confirmed", reported.isLeft))
      })
    )(lease => settle(kernel, RunnerCleanupStage.Release, IO.defer(repo.release(lease.fence)))).use { lease =>
      Resource.make(renew(kernel, lease.fence, signal).start)(fiber => settle(kernel, RunnerCleanupStage.Renewal, cancelJoin(fiber))).flatMap { _ =>
        Resource.make(work(kernel, lease.fence).start) { fiber =>
          kernel.halt(CycleStop.Cancelled) *> settle(kernel, RunnerCleanupStage.Work, cancelJoin(fiber))
        }
      }.use { worker => IO.race(worker.join, signal.get).flatMap {
        case Right(reason) => IO.pure(reason)
        case Left(Outcome.Succeeded(value)) => value
        case Left(Outcome.Errored(_)) => kernel.halt(CycleStop.StoreUncertain).as(CycleStop.StoreUncertain)
        case Left(Outcome.Canceled()) => kernel.halt(CycleStop.Cancelled).as(CycleStop.Cancelled)
      } }
    }
    stopped <- kernel.stopped
  } yield CurationRunResult(reason, stopped)
}
