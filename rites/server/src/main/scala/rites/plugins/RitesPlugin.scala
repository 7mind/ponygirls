package rites.plugins

import cats.effect.{IO, Resource}
import distage.*
import izumi.distage.model.definition.Lifecycle
import izumi.distage.plugins.PluginDef
import rites.*

object RitesPlugin extends PluginDef {
  make[logstage.IzLogger].fromValue(logstage.IzLogger())
  make[RitesStore].fromResource[PostgresStoreResource]
  make[Vault].from { (config: Config) => Vault.load(java.nio.file.Path.of(config.masterKeyFile)) }
  make[ControlService]
  make[HttpApi]
  make[TestRemoteCatalog].fromValue(TestRemoteCatalog.disabled)
  make[GitRepository]
  make[HttpTransport]
  make[Forge].from[HttpForge]
  make[CredentialLocks]
  make[java.time.Clock].fromValue(java.time.Clock.systemUTC())
  make[ForgeTokens].from[OAuthForgeTokens]
  make[PublicationService]
  make[AgentRunner].from[ProcessAgentRunner]
  make[RunCoordinator]
  make[Scheduler]
  make[RuntimeServices]
}
final class PostgresStoreResource(config: Config) extends Lifecycle.FromPair[IO, RitesStore] {
  def acquire: IO[(RitesStore, IO[Unit])] = IO.blocking { val store = new PostgresStore(config); (store, IO.blocking(store.close())) }
}
final case class RuntimeServices(store: RitesStore, http: HttpApi, scheduler: Scheduler, logger: logstage.IzLogger)
