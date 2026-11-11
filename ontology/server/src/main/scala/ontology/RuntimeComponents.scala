package ontology

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.time.Clock
import logstage.IzLogger
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import ontology.http.*
import org.http4s.ember.server.EmberServerBuilder

final case class ServiceRecorder(actor: Actor)
final class RuntimeDiagnostics(logger: IzLogger) extends CurationDiagnostics with CurationRunnerDiagnostics with ProjectionDiagnostics {
  def outcome(value: ScopeOutcome): IO[Unit] = IO(logger.info(s"ontology curation outcome=$value"))
  def stopped(reason: CycleStop): IO[Unit] = IO(logger.warn(s"ontology curation stopped=$reason"))
  def emit(event: RunnerEvent): IO[Unit] = IO(logger.info(s"ontology runner event=$event"))
  def emit(event: ProjectionEvent): IO[Unit] = IO(logger.info(s"ontology projection event=$event"))
}
final class RuntimeCoordinatorFactory(repository: GraphRepository, settings: CurationStoreSettings, model: CuratorModel,
  cursors: CursorSigner, query: QueryLimits, ids: RuntimeIds, diagnostics: CurationDiagnostics, cleanup: CurationCleanup) {
  def create(config: CurationCycleConfig): IO[CurationCoordinator] = CurationCoordinator.create(repository.curation, repository, settings.principal,
    model, cursors, query, config, ids.next, diagnostics, cleanup)
}
final class RuntimeProjectionFactory(repository: GraphRepository, config: ProjectionRuntimeConfig, ids: RuntimeIds,
  diagnostics: ProjectionDiagnostics, cleanup: CurationCleanup) extends ProjectionFactory {
  private val factory = new RdfProjectionFactory(repository.projections(config.settings), config.settings, config.storage, config.resource, config.step,
    ids.next, ids.next, ids.next, diagnostics, cleanup)
  def open(fence: CoordinatorFence, control: ProjectionResourceControl): Resource[IO, ProjectionAttachment] = factory.open(fence, control)
}
final class RuntimeHttpChild(repository: GraphRepository, listener: ListenerConfig, auth: Auth, recorder: ServiceRecorder,
  cursors: CursorSigner, query: QueryLimits, capsules: CapsuleStoreSettings, catalog: ScopeCatalog, schemas: ToolSchemas,
  clock: Clock, ids: RuntimeIds, logger: IzLogger) {
  def open(attachment: ProjectionAttachment): Resource[IO, Unit] = Resource.eval(IO {
    val service = new DefaultOntologyService(repository, cursors, query, capsules, catalog, new LocalExactRdfReadiness(attachment.rdf), recorder.actor, clock, ids.next)
    new HttpApi(auth, service, new Mcp(service, schemas), listener.webRoot, logger, () => ids.fresh()).routes.orNotFound
  }).flatMap { app =>
    EmberServerBuilder.default[IO].withHost(listener.listenHost).withPort(listener.listenPort)
      .withMaxConnections(listener.maxConnections).withMaxHeaderSize(listener.maxHeaderBytes)
      .withShutdownTimeout(listener.shutdown).withHttpApp(app).build.evalTap(server =>
        IO(logger.info(s"ontology HTTP child listening address=${server.address}"))).void
  }
}
final class RuntimeApplication(val repository: PostgresGraphRepository, val runner: CurationRunner) {
  def run: IO[CurationRunResult] = repository.initialize *> runner.run
}
