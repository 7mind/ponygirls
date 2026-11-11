package ontology.curation

import cats.effect.{IO, Resource}
import cats.effect.kernel.Outcome
import cats.syntax.all.*
import java.util.UUID
import ontology.*
import ontology.api.*
import ontology.domain.Require
import scala.concurrent.duration.*

final case class CurationCycleConfig(scanLimit: Int, recoveryLimit: Int, cleanupBudget: FiniteDuration) {
  Require(scanLimit > 0 && recoveryLimit > 0 && cleanupBudget > Duration.Zero, "config", "positive cycle bounds required")
}
enum CycleStop {
  case ClaimUncertain, StoreUncertain, PublicationUncertain, CleanupUncertain, CleanupOverBudget
  case Cancelled, OwnershipLost, DiagnosticFailure
}
enum ScopeOutcome {
  case Ineligible(scope: String)
  case NotStarted(scope: String)
  case Replayed(scope: String, attemptId: UUID)
  case Terminal(scope: String, attemptId: UUID, state: CurationAttemptState, code: Option[String])
  case Published(receipt: CurationPublicationReceipt)
  case Uncertain(scope: String, attemptId: UUID)
}
final case class CycleReport(recovery: Option[CurationRecoveryBatch], scan: Option[CurationScopeBatch], outcomes: List[ScopeOutcome], stopped: Option[CycleStop])
trait CurationDiagnostics {
  def outcome(value: ScopeOutcome): IO[Unit]
  def stopped(reason: CycleStop): IO[Unit]
}
enum CleanupObservation {
  case Observed(value: ScopeOutcome)
  case Uncertain
}
trait CurationCleanup {
  def observe(budget: FiniteDuration, work: IO[ScopeOutcome], overdue: IO[Unit]): IO[CleanupObservation]
}
final class SupervisedCurationCleanup extends CurationCleanup {
  private def result(outcome: Outcome[IO, Throwable, Either[Throwable, ScopeOutcome]]): IO[CleanupObservation] = outcome match {
    case Outcome.Succeeded(value) => value.map(_.fold(_ => CleanupObservation.Uncertain, CleanupObservation.Observed(_)))
    case _ => IO.pure(CleanupObservation.Uncertain)
  }
  def observe(budget: FiniteDuration, work: IO[ScopeOutcome], overdue: IO[Unit]): IO[CleanupObservation] =
    Resource.make(work.attempt.start)(_.cancel).use { fiber =>
      IO.race(fiber.join, IO.sleep(budget)).flatMap {
        case Left(outcome) => result(outcome)
        // Cancelling a join does not cancel its owned work; report the cutoff, then settle it.
        case Right(_) => overdue *> fiber.join.flatMap(result)
      }
    }
}
