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
  case Cancelled, OwnershipLost, DiagnosticFailure, ProjectionUncertain, ProjectionRejected
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
enum CleanupObservation[+A] {
  case Observed(value: A)
  case ObservedDiagnosticFailure(value: A)
  case Uncertain
  case UncertainDiagnosticFailure
}
trait CurationCleanup {
  def observe[A](budget: FiniteDuration, work: IO[A], overdue: IO[Unit]): IO[CleanupObservation[A]]
}
final class SupervisedCurationCleanup extends CurationCleanup {
  private def result[A](outcome: Outcome[IO, Throwable, Either[Throwable, A]]): IO[CleanupObservation[A]] = outcome match {
    case Outcome.Succeeded(value) => value.map(_.fold(_ => CleanupObservation.Uncertain, CleanupObservation.Observed(_)))
    case _ => IO.pure(CleanupObservation.Uncertain)
  }
  def observe[A](budget: FiniteDuration, work: IO[A], overdue: IO[Unit]): IO[CleanupObservation[A]] = IO.defer {
    Require(budget > Duration.Zero, "config", "positive cleanup budget required")
    Resource.make(work.attempt.start)(fiber => fiber.cancel.guarantee(fiber.join.void)).use { fiber =>
      IO.race(fiber.join, IO.sleep(budget)).flatMap {
        case Left(outcome) => result(outcome)
        // Reporting failure must not cancel work or discard a result observed afterward.
        case Right(_) => overdue.attempt.flatMap { notice =>
          fiber.join.flatMap(result[A]).map {
            case CleanupObservation.Observed(value) if notice.isLeft => CleanupObservation.ObservedDiagnosticFailure(value)
            case CleanupObservation.Uncertain if notice.isLeft => CleanupObservation.UncertainDiagnosticFailure
            case observed => observed
          }
        }
      }
    }
  }
}
