package manure.plugins

import manure.*
import cats.effect.IO
import cats.effect.std.Semaphore
import distage.*
import izumi.distage.plugins.PluginDef
import ponygirls.runtime.JdbcDatabase
import ponygirls.retrieval.{EmbeddingClient,RetrievalProfile}
import ponygirls.retrieval.postgres.PostgresRetrieval
import manure.storage.{ConfinedDirectory,RootLease}

final class RuntimeTransactions(database: JdbcDatabase,root: RootLease) extends JdbcTransactions:
  def transaction[A](body: java.sql.Connection => A): IO[A] = database.transaction(c => root.run(body(c)))

final class RuntimeServices(val artifacts: Artifacts,val http: Http,val search: Search,
  val projection: SearchProjection,val worker: SearchWorker,val database: JdbcTransactions)

/** Explicit plugin graph, no native classpath scanning or handwritten constructor
  * forwarding. Lifecycle resources are acquired once by Main in dependency order;
  * the same graph is planned by tests and the installed executable.
  */
object ManurePlugin extends PluginDef:
  make[Limits].from((config: Config) => config.limits)
  make[Option[EmbeddingSettings]].from((config: Config) => config.embedding)
  make[DomainClock].fromValue(SystemDomainClock)
  make[Faults].fromValue(NoFaults)
  make[Auth]
  make[Vector[UserConfig]].from((config: Config) => config.users)
  make[JdbcTransactions].from[RuntimeTransactions]
  make[PostgresRetrieval].from { (config: Config) =>
    new PostgresRetrieval("manure",config.embedding.map(e => RetrievalProfile(e.endpoint.space,"manure-metadata-paths-v1")))
  }
  make[SearchProjection]
  make[Metadata].from[PostgresMetadata]
  make[Payloads].from[FilesystemPayloads]
  make[Artifacts]
  make[Catalogue]
  make[Search]
  make[SearchWorker]
  make[Http]
  make[RuntimeServices]
