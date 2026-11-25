package manure.plugins

import manure.*
import cats.effect.IO
import cats.effect.std.Semaphore
import distage.*
import izumi.distage.plugins.PluginDef
import ponygirls.runtime.JdbcDatabase
import ponygirls.retrieval.EmbeddingClient
import ponygirls.retrieval.postgres.PostgresRetrieval
import manure.storage.{ConfinedDirectory,RootLease}
import ponygirls.auth.PasswordHasher

final class RuntimeTransactions(database: JdbcDatabase,root: RootLease) extends JdbcTransactions:
  def transaction[A](body: java.sql.Connection => A): IO[A] = database.transaction(c => root.run(body(c)))
  override lazy val background: JdbcTransactions = new RuntimeTransactions(database.background,root)

final class RuntimeServices(val artifacts: Artifacts,val http: Http,val search: Search,
  val projection: SearchProjection,val worker: SearchWorker,val database: JdbcTransactions,val accounts: Accounts)

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
  make[Option[AccountsConfig]].from((config: Config) => config.accounts)
  make[PasswordHasher].fromValue(PasswordHasher.Pbkdf2)
  make[JdbcTransactions].from[RuntimeTransactions]
  make[PostgresRetrieval].from(SearchProjection.retrieval)
  make[SearchProjection]
  make[Metadata].from[PostgresMetadata]
  make[Payloads].from[FilesystemPayloads]
  make[Artifacts]
  make[Accounts]
  make[AccountPlane]
  make[Catalogue]
  make[Search]
  // The indexing worker on the background admission (restart-robustness spec §5); requests stay on the request admission.
  make[SearchWorker].from { (database: JdbcTransactions,root: RootLease,engine: PostgresRetrieval,client: Option[EmbeddingClient],settings: Option[EmbeddingSettings]) =>
    new SearchWorker(database.background,root,engine,client,settings)
  }
  make[Http]
  make[RuntimeServices]
