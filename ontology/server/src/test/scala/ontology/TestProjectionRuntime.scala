package ontology

import cats.effect.{IO, Resource}
import java.util.UUID
import ontology.api.*
import ontology.curation.*
import scala.concurrent.duration.*

object TestProjectionRuntime {
  def factory(repo: GraphRepository, settings: CurationStoreSettings): ProjectionFactory = {
    val principal = Principal("projection-fixture", Actor("projection-fixture", ActorKind.Service), settings.scopes, Set(Capability.Read))
    val config = ProjectionSettings(principal, "runner-fixture", settings.scopes, settings.maxScanScopes)
    new RdfProjectionFactory(repo.projections(config), config, RdfStorage.Memory, ProjectionResourceConfig(10, 5.seconds, 5.seconds),
      ProjectionStepConfig(5.seconds), IO(UUID.randomUUID()), IO(UUID.randomUUID()), IO(UUID.randomUUID()),
      new ProjectionDiagnostics { def emit(event: ProjectionEvent): IO[Unit] = IO.unit }, new SupervisedCurationCleanup)
  }
  def noServer(attachment: ProjectionAttachment): Resource[IO, Unit] = Resource.unit[IO]
}
