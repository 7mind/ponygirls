package ontology.curation

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.util.UUID
import ontology.*
import ontology.api.*
import ontology.domain.*
import scala.concurrent.duration.*

final case class ProjectionAttachment(rdf: RdfProjection, step: ProjectionStep)
trait ProjectionResourceControl extends ProjectionControl {
  def resourceClosed(value: CleanupObservation[Unit]): IO[Unit]
}
trait ProjectionFactory {
  def open(fence: CoordinatorFence, control: ProjectionResourceControl): Resource[IO, ProjectionAttachment]
}
final case class ProjectionResourceConfig(queryDeadlineSeconds: Int, observationBudget: FiniteDuration, closeBudget: FiniteDuration) {
  Require(queryDeadlineSeconds > 0 && observationBudget > Duration.Zero && closeBudget > Duration.Zero, "config", "positive projection resource bounds required")
}

final class RdfProjectionFactory(owner: ProjectionRepository, settings: ProjectionSettings, storage: RdfStorage,
  config: ProjectionResourceConfig, stepConfig: ProjectionStepConfig, sessionIds: IO[UUID], incarnationIds: IO[UUID], ackIds: IO[UUID],
  diagnostics: ProjectionDiagnostics, cleanup: CurationCleanup) extends ProjectionFactory {
  private def accepting(control: ProjectionControl): IO[Unit] = control.stopped.flatMap(value => IO(Require(value.isEmpty, "coordinator-stopped", "projection resource admission stopped")))
  private def code(error: Throwable): String = error match {
    case f: Fault if f.code.matches("[a-z][a-z0-9-]{0,63}") => f.code
    case _ => "projection-resource-failed"
  }
  private def emit(control: ProjectionControl, event: ProjectionEvent): IO[Unit] = diagnostics.emit(event).handleErrorWith(_ =>
    control.diagnosticFailure *> IO.raiseError(Fault("curation-diagnostic", "projection resource diagnostic failed")))
  private def overdue(control: ProjectionControl, stage: ProjectionStage): IO[Unit] =
    control.halt(CycleStop.CleanupOverBudget) *> emit(control, ProjectionEvent.OverBudget(stage))
  private def observed[A](control: ProjectionControl, stage: ProjectionStage, work: IO[A]): IO[Either[Throwable, A]] =
    cleanup.observe(config.observationBudget, work.attempt, overdue(control, stage)).attempt.flatMap {
      case Right(CleanupObservation.Observed(value)) => IO.pure(value)
      case Right(CleanupObservation.ObservedDiagnosticFailure(value)) => control.diagnosticFailure.as(value)
      case Right(CleanupObservation.UncertainDiagnosticFailure) => control.diagnosticFailure.as(Left(Fault("projection-resource-uncertain", "resource outcome was not observed")))
      case _ => IO.pure(Left(Fault("projection-resource-uncertain", "resource outcome was not observed")))
    }
  private def failed[A](control: ProjectionControl, stage: ProjectionStage, error: Throwable): IO[A] = {
    val reason = error match {
      case f: Fault if f.code == "coordinator" || f.code == "coordinator-stopped" => CycleStop.OwnershipLost
      case f: Fault if f.code.endsWith("-uncertain") => CycleStop.ProjectionUncertain
      case _: Fault => CycleStop.ProjectionRejected
      case _ => CycleStop.ProjectionUncertain
    }
    control.halt(reason) *> emit(control, ProjectionEvent.Unconfirmed(stage, code(error))).attempt *>
      IO.raiseError(Fault("projection-resource-uncertain", "projection resource could not be confirmed: " + code(error)))
  }
  private def close(control: ProjectionResourceControl, work: IO[Unit]): IO[Unit] =
    cleanup.observe(config.closeBudget, work, overdue(control, ProjectionStage.RdfClose)).attempt.flatMap { result =>
      val observation = result.fold(_ => CleanupObservation.Uncertain, identity)
      control.resourceClosed(observation) *> (observation match {
        case CleanupObservation.Observed(_) => IO.unit
        case CleanupObservation.ObservedDiagnosticFailure(_) => control.diagnosticFailure *>
          IO.raiseError(Fault("curation-diagnostic", "RDF closed but its diagnostic failed"))
        case CleanupObservation.UncertainDiagnosticFailure => control.diagnosticFailure *>
          failed(control, ProjectionStage.RdfClose, Fault("projection-close-uncertain", "RDF close and diagnostics were not confirmed"))
        case CleanupObservation.Uncertain => failed(control, ProjectionStage.RdfClose, Fault("projection-close-uncertain", "RDF close was not confirmed"))
      })
    }
  private def session(rdf: RdfProjection, fence: CoordinatorFence, control: ProjectionControl): IO[ProjectionSession] =
    accepting(control) *> sessionIds.flatMap { id =>
      def invoke: IO[Either[Throwable, ProjectionSession]] = observed(control, ProjectionStage.SessionOpen,
        accepting(control) *> IO.defer(owner.open(id, fence, rdf.instance)))
      invoke.flatMap {
        case Right(value) => IO.pure(value)
        case Left(error: Fault) => failed(control, ProjectionStage.SessionOpen, error)
        case Left(_) => accepting(control) *> invoke.flatMap {
          case Right(value) => IO.pure(value)
          case Left(error) => failed(control, ProjectionStage.SessionOpen, error)
        }
      }.flatMap { value => IO {
        ProjectionProtocol.session(value)
        Require(value.id == id && value.fence == fence && value.instance == rdf.instance && value.actor == settings.principal.actor &&
          value.scopes == settings.scopes.toList.sorted && value.batchLimit == settings.batchLimit, "projection-binding", "projection bootstrap acknowledgment differs")
        value
      }.handleErrorWith(error => failed(control, ProjectionStage.SessionOpen, error)) }
    }
  def open(fence: CoordinatorFence, control: ProjectionResourceControl): Resource[IO, ProjectionAttachment] =
    Resource.eval(accepting(control)) *> RdfProjection.managed(storage, settings.targetId, config.queryDeadlineSeconds, incarnationIds,
      work => observed(control, ProjectionStage.RdfOpen, accepting(control) *> work).flatMap {
        case Right(value) => IO.pure(value)
        case Left(error) => failed(control, ProjectionStage.RdfOpen, error)
      }, work => close(control, work)).evalMap { rdf => for {
        _ <- accepting(control)
        value <- session(rdf, fence, control)
        _ <- accepting(control)
        step <- SerialProjectionStep.create(owner, settings.principal, rdf, value, stepConfig, ackIds, control, diagnostics, cleanup)
      } yield ProjectionAttachment(rdf, step) }
}
