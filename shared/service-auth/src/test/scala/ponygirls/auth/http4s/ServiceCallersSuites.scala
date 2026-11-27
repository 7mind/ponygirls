package ponygirls.auth.http4s

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import java.sql.{Connection, DriverManager}
import java.util.concurrent.atomic.AtomicReference
import ponygirls.auth.{AccountSql, AccountStorage, ConnectionTransactions, DeclaredDirectory, DeclaredInstallation, ImperativeAccountSql, ImperativeSettings,
  IndexingPreferenceSql, MemoryAccountStorage, PasswordHasher, SharedAccountStorage}
import scala.util.Using

/** The in-memory store; the consumer keeps its declared-id records beside it and changes them in the store's transaction,
  * after the shared installation succeeded. */
final class MemoryServiceCallersSuite extends ServiceCallersContract {
  private given IORuntime = FrozenTime.runtime
  protected def withBackend(body: Backend => Unit): Unit = body(new Backend {
    private val ids = new AtomicReference(Map.empty[String, Boolean])
    val storage: AccountStorage = new MemoryAccountStorage(FrozenTime.clock)
    val installation: DeclaredInstallation[ChatSnapshot] = DeclaredInstallation.Own(s => storage.transaction { store =>
      val next = DeclaredIdBinding.next(ids.get, s)
      store.installDeclared(s.declared, s.users)
      ids.set(next)
    })
    def recorded(): Map[String, Boolean] = storage.transaction(_ => ids.get).unsafeRunSync()
    def administrator(settings: Option[ImperativeSettings], declared: DeclaredDirectory, userId: String): Boolean =
      storage.transaction(_.imperative(settings, declared, () => declared.users, PasswordHasher.Pbkdf2, FrozenTime.clock).administrator(userId)).unsafeRunSync()
  })
}

/** The shared PostgreSQL tables through `SharedAccountStorage`, the consumer's records in a table of its own changed by
  * `SharedAccountStorage.checked`: one connection for the suite, every transaction committed, the tables emptied before
  * and after each case. */
final class PostgresServiceCallersSuite extends ServiceCallersContract {
  private var opened = Option.empty[Connection]
  private def connection(): Connection = opened.getOrElse {
    val jdbc = sys.env.getOrElse("ACCOUNT_TEST_JDBC",
      fail("PostgreSQL required: run shared/service-auth/scripts/test-postgres.sh or nix/tests/shared-jvm.sh, which own the database and set ACCOUNT_TEST_JDBC"))
    val created = DriverManager.getConnection(jdbc, "account_test", "synthetic-test-password")
    opened = Some(created)
    created.setAutoCommit(false)
    AccountSql.initialize(created)
    ImperativeAccountSql.initialize(created)
    IndexingPreferenceSql.initialize(created)
    Using.resource(created.createStatement())(_.execute("CREATE TABLE IF NOT EXISTS consumer_declared_ids(id text PRIMARY KEY, removed boolean NOT NULL)"))
    created.commit()
    created
  }
  override def afterAll(): Unit = {
    opened.foreach(_.close())
    super.afterAll()
  }
  private def empty(c: Connection): Unit = {
    Using.resource(c.createStatement())(_.execute("""TRUNCATE ponygirls_imperative_users,ponygirls_imperative_enrollments,
      ponygirls_account_users,ponygirls_account_sessions,ponygirls_account_tokens,ponygirls_indexing_preferences,consumer_declared_ids"""))
    c.commit()
  }
  private def records(c: Connection): Map[String, Boolean] = Using.resource(c.prepareStatement("SELECT id,removed FROM consumer_declared_ids")) { statement =>
    Using.resource(statement.executeQuery()) { result =>
      Iterator.continually(result).takeWhile(_.next()).map(row => row.getString(1) -> row.getBoolean(2)).toMap
    }
  }
  private def store(c: Connection, next: Map[String, Boolean]): Unit = {
    Using.resource(c.createStatement())(_.execute("DELETE FROM consumer_declared_ids"))
    Using.resource(c.prepareStatement("INSERT INTO consumer_declared_ids(id,removed) VALUES(?,?)")) { statement =>
      next.foreach { (id, removed) =>
        statement.setString(1, id)
        statement.setBoolean(2, removed)
        statement.executeUpdate()
      }
    }
  }
  protected def withBackend(body: Backend => Unit): Unit = {
    given IORuntime = FrozenTime.runtime
    val c = connection()
    empty(c)
    val transactions = new ConnectionTransactions {
      def transaction[A](work: Connection => A): IO[A] = IO.blocking(c.synchronized {
        try {
          val result = work(c)
          c.commit()
          result
        } catch { case failure: Throwable => c.rollback(); throw failure }
      })
    }
    val shared = new SharedAccountStorage(transactions, (_, fingerprints) => fingerprints)
    try body(new Backend {
      val storage: AccountStorage = shared
      val installation: DeclaredInstallation[ChatSnapshot] = shared.checked[ChatSnapshot]((c, s) => store(c, DeclaredIdBinding.next(records(c), s)))
      def recorded(): Map[String, Boolean] = transactions.transaction(records).unsafeRunSync()
      def administrator(settings: Option[ImperativeSettings], declared: DeclaredDirectory, userId: String): Boolean =
        transactions.transaction(c => ImperativeAccountSql.administrator(c, settings, declared, userId)).unsafeRunSync()
    }) finally empty(c)
  }
}
