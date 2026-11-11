package ontology

import cats.effect.{IO, Resource}
import distage.ModuleDef
import java.time.Clock
import java.util.UUID
import logstage.IzLogger
import ontology.curation.*
import ontology.domain.*
import ontology.http.*
import ponygirls.runtime.JdbcDatabase

final class RepositoryModule(config: Config, database: JdbcDatabase) extends ModuleDef {
  make[Config].fromValue(config)
  make[JdbcDatabase].fromValue(database)
  make[ReviewLimits].from((value: Config) => value.review)
  make[CurationStoreSettings].from((value: Config) => value.curation)
  make[AdmissionEngine]
  make[ReviewDomain]
  make[PostgresGraphRepository]
  make[GraphRepository].from((value: PostgresGraphRepository) => value)
  make[GraphReadRepository].from((value: GraphRepository) => value)
  make[CurationRepository].from((value: GraphRepository) => value.curation)
}
final class RuntimeModule(inputs: RuntimeInputs) extends ModuleDef {
  include(new RepositoryModule(inputs.config, inputs.database))
  make[CuratorModel].fromValue(inputs.model)
  make[Auth].fromValue(inputs.auth)
  make[CursorSigner].fromValue(inputs.cursors)
  make[Clock].fromValue(inputs.environment.clock)
  make[RuntimeIds].fromValue(inputs.environment.ids)
  make[IzLogger].fromValue(inputs.environment.logger)
  make[ListenerConfig].from((value: Config) => value.http)
  make[ServiceRecorder].from((value: Config) => ServiceRecorder(value.serviceActor))
  make[QueryLimits].from((value: Config) => value.query)
  make[CapsuleStoreSettings].from((value: Config) => value.capsule)
  make[CurationCycleConfig].from((value: Config) => value.cycle)
  make[CurationRunnerConfig].from((value: Config) => value.runner)
  make[ProjectionRuntimeConfig].from((value: Config) => value.projection)
  make[RuntimeDiagnostics]
  make[CurationDiagnostics].from((value: RuntimeDiagnostics) => value)
  make[CurationRunnerDiagnostics].from((value: RuntimeDiagnostics) => value)
  make[ProjectionDiagnostics].from((value: RuntimeDiagnostics) => value)
  make[CurationCleanup].from[SupervisedCurationCleanup]
  make[ScopeCatalog].from[GrantedScopeCatalog]
  make[ToolSchemas].from[CompiledToolSchemas]
  make[RuntimeCoordinatorFactory]
  make[ProjectionFactory].from[RuntimeProjectionFactory]
  make[RuntimeHttpChild]
  make[IO[UUID]].from((value: RuntimeIds) => value.next)
  make[CurationCycleConfig => IO[CurationCoordinator]].from((value: RuntimeCoordinatorFactory) => value.create _)
  make[ProjectionAttachment => Resource[IO, Unit]].from((value: RuntimeHttpChild) => value.open _)
  make[CurationRunner]
  make[RuntimeApplication]
}
