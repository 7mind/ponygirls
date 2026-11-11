package ontology.curation

import cats.effect.{IO, Ref as Cell}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import java.util.UUID
import ontology.*
import ontology.api.*
import ontology.domain.*
import scala.concurrent.duration.*

final case class ProjectionStepConfig(ioObservationBudget: FiniteDuration) {
  Require(ioObservationBudget > Duration.Zero, "config", "positive projection IO observation budget required")
}
enum ProjectionStage { case RdfOpen, SessionOpen, RdfClose, Reconciliation, Pending, Publish, Observe, Acknowledge, Receipt }
enum ProjectionEvent {
  case OverBudget(stage: ProjectionStage)
  case Unconfirmed(stage: ProjectionStage, code: String)
  case Acknowledged(receipt: ProjectionAckReceipt, replayed: Boolean)
}
trait ProjectionDiagnostics { def emit(event: ProjectionEvent): IO[Unit] }
trait ProjectionControl {
  def stopped: IO[Option[CycleStop]]
  def halt(reason: CycleStop): IO[Unit]
  def diagnosticFailure: IO[Unit]
}
enum ProjectionOutcome {
  case Confirmed(receipt: ProjectionAckReceipt, replayed: Boolean)
  case Unconfirmed(target: Option[ProjectionTarget], stage: ProjectionStage, code: String)
}
final case class PendingProjectionAck(input: ProjectionAckInput, observation: ProjectionObservation)
final case class ProjectionPending(target: Option[ProjectionTarget], stage: ProjectionStage, acknowledgment: Option[PendingProjectionAck])
final case class ProjectionStepReport(reconciliationComplete: Boolean, outcomes: List[ProjectionOutcome], pending: Option[ProjectionPending], stopped: Option[CycleStop])
trait ProjectionStep {
  def advance: IO[ProjectionStepReport]
  def report: IO[ProjectionStepReport]
}

final class SerialProjectionStep private (owner: ProjectionRepository, principal: Principal, rdf: RdfProjection, session: ProjectionSession,
  config: ProjectionStepConfig, ids: IO[UUID], control: ProjectionControl, diagnostics: ProjectionDiagnostics,
  cleanup: CurationCleanup, serial: Semaphore[IO], progress: Cell[IO, ProjectionStepReport]) extends ProjectionStep {
  private def code(error: Throwable): String = error match {
    case fault: Fault if fault.code.matches("[a-z][a-z0-9-]{0,63}") => fault.code
    case _ => "projection-operation-failed"
  }
  private def definite(error: Throwable): Boolean = error match {
    case fault: Fault => Set("scope", "identity", "reference", "corrupt", "projection-conflict", "projection-observation", "projection-target", "projection-format", "projection-progress", "projection-stale", "forbidden", "replay-conflict", "config", "coordinator", "coordinator-stopped").contains(fault.code)
    case _ => false
  }
  private def emit(event: ProjectionEvent): IO[Unit] = diagnostics.emit(event).handleErrorWith(_ => control.diagnosticFailure)
  private def accepting: IO[Unit] = control.stopped.flatMap(value => IO(Require(value.isEmpty, "coordinator-stopped", "projection admissions stopped")))
  private def track(target: Option[ProjectionTarget], stage: ProjectionStage, acknowledgment: Option[PendingProjectionAck]): IO[Unit] =
    progress.update(_.copy(pending = Some(ProjectionPending(target, stage, acknowledgment))))
  private def io[A](stage: ProjectionStage, work: IO[A]): IO[Either[Throwable, A]] =
    progress.update(value => value.copy(pending = Some(value.pending.fold(ProjectionPending(None, stage, None))(_.copy(stage = stage))))) *>
    cleanup.observe(config.ioObservationBudget, work.attempt, control.halt(CycleStop.CleanupOverBudget) *> emit(ProjectionEvent.OverBudget(stage))).attempt.flatMap {
      case Right(CleanupObservation.Observed(value)) => IO.pure(value)
      case Right(CleanupObservation.ObservedDiagnosticFailure(value)) => control.diagnosticFailure.as(value)
      case Right(CleanupObservation.UncertainDiagnosticFailure) => control.diagnosticFailure.as(Left(Fault("projection-io-uncertain", "projection IO result was not observed")))
      case _ => IO.pure(Left(Fault("projection-io-uncertain", "projection IO result was not observed")))
    }
  private def stop(target: Option[ProjectionTarget], stage: ProjectionStage, error: Throwable): IO[Unit] = {
    val reason = error match {
      case f: Fault if f.code == "coordinator" => CycleStop.OwnershipLost
      case _ if definite(error) => CycleStop.ProjectionRejected
      case _ => CycleStop.ProjectionUncertain
    }
    IO.uncancelable { _ =>
      progress.update(value => value.copy(outcomes = value.outcomes :+ ProjectionOutcome.Unconfirmed(target, stage, code(error)))) *> control.halt(reason)
    } *> emit(ProjectionEvent.Unconfirmed(stage, code(error)))
  }
  private def confirm(input: ProjectionAckInput, value: ProjectionAckResult): IO[Unit] = IO {
    Require(value.receipt.input == input, "corrupt", "projection acknowledgment response differs")
    ProjectionProtocol.receipt(session, value.receipt)
  } *> progress.update(report => report.copy(outcomes = report.outcomes :+ ProjectionOutcome.Confirmed(value.receipt, value.replayed), pending = None)) *>
    emit(ProjectionEvent.Acknowledged(value.receipt, value.replayed))
  private def inspect(input: ProjectionAckInput): IO[Either[Throwable, Option[ProjectionAckResult]]] =
    io(ProjectionStage.Receipt, IO.defer(owner.receipt(principal, input.target.scope, input.sessionId, input.requestId))).map(_.map(_.map { value =>
      Require(value.input == input, "corrupt", "retained projection receipt differs")
      ProjectionProtocol.receipt(session, value)
      ProjectionAckResult(value, true)
    }))
  private def send(input: ProjectionAckInput, observed: ProjectionObservation): IO[Either[Throwable, ProjectionAckResult]] = IO.uncancelable { poll =>
    track(Some(input.target), ProjectionStage.Acknowledge, Some(PendingProjectionAck(input, observed))) *>
      poll(io(ProjectionStage.Acknowledge, accepting *> IO.defer(owner.acknowledge(input, observed))))
  }
  private def uncertainAck(input: ProjectionAckInput, observed: ProjectionObservation, error: Throwable): IO[Unit] = inspect(input).flatMap {
    case Right(Some(value)) => confirm(input, value)
    case Right(None) => control.stopped.flatMap {
      case Some(_) => stop(Some(input.target), ProjectionStage.Acknowledge, error)
      case None => send(input, observed).flatMap {
        case Right(value) => confirm(input, value)
        case Left(last) => inspect(input).flatMap {
          case Right(Some(value)) => confirm(input, value)
          case _ => stop(Some(input.target), ProjectionStage.Acknowledge, last)
        }
      }
    }
    case Left(failure) => stop(Some(input.target), ProjectionStage.Receipt, failure)
  }
  private def observe(target: ProjectionTarget): IO[Either[Throwable, ProjectionObservation]] = track(Some(target), ProjectionStage.Observe, None) *>
    io(ProjectionStage.Observe, IO.defer(rdf.observe(target.scope)).map { found =>
    val value = found.getOrElse(throw Fault("projection-observation-absent", "no local observation after publication"))
    Require(value.checkpoint.instance == session.instance && value.checkpoint.scope == target.scope && value.checkpoint.generation >= target.generation &&
      value.snapshot.scope == target.scope && value.snapshot.generation == value.checkpoint.generation &&
      ProjectionProtocol.target(value.snapshot, ProjectionTargetOrigin.Head).digest == value.checkpoint.digest,
      "projection-observation", "local projection observation differs from target or instance")
    value
  })
  private def acknowledge(target: ProjectionTarget, observed: ProjectionObservation, allowReobserve: Boolean): IO[Unit] =
    track(Some(target), ProjectionStage.Acknowledge, None) *> io(ProjectionStage.Acknowledge, accepting *> ids).flatMap {
      case Left(error) => stop(Some(target), ProjectionStage.Acknowledge, error)
      case Right(id) =>
      val input = ProjectionAckInput(session.id, id, target, observed.checkpoint)
      send(input, observed).flatMap {
        case Right(value) => confirm(input, value)
        case Left(f: Fault) if f.code == "projection-stale" && allowReobserve => accepting *> observe(target).flatMap {
          case Right(newer) => acknowledge(target, newer, false)
          case Left(error) => stop(Some(target), ProjectionStage.Observe, error)
        }
        case Left(error) if definite(error) || code(error) == "projection-stale" => stop(Some(target), ProjectionStage.Acknowledge, error)
        case Left(error) => uncertainAck(input, observed, error)
      }
    }
  private def one(work: ProjectionWork): IO[Unit] = control.stopped.flatMap {
    case Some(_) => IO.unit
    case None => (track(Some(work.target), ProjectionStage.Publish, None) *> io(ProjectionStage.Publish, accepting *> IO.defer(rdf.publish(work.snapshot)))).flatMap {
      case Left(error) if definite(error) => stop(Some(work.target), ProjectionStage.Publish, error)
      case _ => observe(work.target).flatMap {
        case Right(value) => control.stopped.flatMap {
          case Some(_) => stop(Some(work.target), ProjectionStage.Acknowledge, Fault("coordinator-stopped", "projection stopped before acknowledgment"))
          case None => acknowledge(work.target, value, true)
        }
        case Left(error) => stop(Some(work.target), ProjectionStage.Observe, error)
      }
    }
  }
  private def batch(value: ProjectionWorkBatch, heads: Boolean): IO[Unit] = IO {
    Require(value.session == session && value.work.size <= session.batchLimit && (heads || value.reconciliationComplete), "corrupt", "projection work batch differs from session")
    Require(value.work.map(_.target).distinct.size == value.work.size && (!heads || value.work.nonEmpty), "corrupt", "invalid projection work inventory")
    val positions = value.work.map(work => (work.target.scope, work.target.generation))
    Require(positions == positions.sorted && (!heads || value.work.map(_.target.scope).distinct.size == value.work.size), "corrupt", "projection work order differs")
    value.work.foreach { work =>
      principal.require(work.target.scope, Capability.Read)
      Require(session.scopes.contains(work.target.scope) && work.target.origin == (if (heads) ProjectionTargetOrigin.Head else ProjectionTargetOrigin.Outbox) &&
        ProjectionProtocol.target(work.snapshot, work.target.origin) == work.target, "corrupt", "projection work differs from target")
    }
  } *> progress.update(_.copy(reconciliationComplete = value.reconciliationComplete)) *> value.work.traverse_(one)
  def report: IO[ProjectionStepReport] = (progress.get, control.stopped).mapN((value, stopped) => value.copy(stopped = stopped))
  private def cancelled: IO[Unit] = progress.get.flatMap { value =>
    val recorded = value.pending.fold(IO.unit)(pending => progress.update(report => report.copy(outcomes = report.outcomes :+
      ProjectionOutcome.Unconfirmed(pending.target, pending.stage, "projection-cancelled"))))
    recorded *> control.halt(CycleStop.Cancelled) *> value.pending.flatMap(_.acknowledgment).fold(IO.unit) { ack =>
      inspect(ack.input).flatMap {
        case Right(Some(receipt)) => confirm(ack.input, receipt)
        case Left(error) => stop(Some(ack.input.target), ProjectionStage.Receipt, error)
        case Right(None) => IO.unit
      }.handleErrorWith(error => stop(Some(ack.input.target), ProjectionStage.Receipt, error))
    }
  }
  def advance: IO[ProjectionStepReport] = serial.permit.use { _ => control.stopped.flatMap {
    case Some(_) => report
    case None =>
    (progress.set(ProjectionStepReport(false, Nil, None, None)) *> control.stopped.flatMap {
      case Some(_) => IO.unit
      case None => io(ProjectionStage.Reconciliation, accepting *> IO.defer(owner.reconcileHeads(session.id))).flatMap {
        case Left(error) => stop(None, ProjectionStage.Reconciliation, error)
        case Right(value) if !value.reconciliationComplete => batch(value, true)
        case Right(value) =>
          IO(Require(value.session == session && value.work.isEmpty, "corrupt", "completed reconciliation returned work")) *>
            io(ProjectionStage.Pending, accepting *> IO.defer(owner.pending(session.id))).flatMap {
              case Left(error) => stop(None, ProjectionStage.Pending, error)
              case Right(pending) => batch(pending, false)
            }
      }
    }).handleErrorWith(error => progress.get.flatMap { value =>
      value.pending.fold(stop(None, ProjectionStage.Reconciliation, error))(pending => stop(pending.target, pending.stage, error))
    }).onCancel(cancelled) *>
      control.stopped.flatMap { stopped => if (stopped.isEmpty) progress.update(_.copy(pending = None)) else IO.unit } *> report
  } }
}
object SerialProjectionStep {
  def create(owner: ProjectionRepository, principal: Principal, rdf: RdfProjection, session: ProjectionSession, config: ProjectionStepConfig,
    ids: IO[UUID], control: ProjectionControl, diagnostics: ProjectionDiagnostics, cleanup: CurationCleanup): IO[ProjectionStep] = for {
    _ <- IO {
      ProjectionProtocol.session(session)
      Require(principal.actor == session.actor && rdf.instance == session.instance, "config", "projection step binding differs from session")
      session.scopes.foreach(principal.require(_, Capability.Read))
    }
    serial <- Semaphore[IO](1)
    progress <- Cell.of[IO, ProjectionStepReport](ProjectionStepReport(false, Nil, None, None))
  } yield new SerialProjectionStep(owner, principal, rdf, session, config, ids, control, diagnostics, cleanup, serial, progress)
}
