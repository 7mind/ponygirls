package ponygirls.auth.http4s

import cats.effect.IO
import java.sql.{Connection, DriverManager}
import ponygirls.auth.{AccountSql, AccountStorage, ConnectionTransactions, ImperativeAccountSql, IndexingPreferenceSql, MemoryAccountStorage, SharedAccountStorage}
import scala.util.Using

final class MemoryAccountPlaneSuite extends AccountPlaneContract {
  protected def withStorage(body: AccountStorage => Unit): Unit = body(new MemoryAccountStorage)
}

/** The shared PostgreSQL tables through `SharedAccountStorage`: one connection for the suite, every transaction committed,
  * the tables emptied before and after each case. */
final class PostgresAccountPlaneSuite extends AccountPlaneContract {
  private var opened = Option.empty[Connection]
  private def connection(): Connection = opened.getOrElse {
    val jdbc = sys.env.get("ACCOUNT_TEST_JDBC")
    if (jdbc.isEmpty) {
      assert(!sys.env.contains("ACCOUNT_REQUIRE_POSTGRES"), "PostgreSQL required")
      assume(false, "PostgreSQL explicitly skipped: use shared/service-auth/scripts/test-postgres.sh")
    }
    val created = DriverManager.getConnection(jdbc.get, "account_test", "synthetic-test-password")
    opened = Some(created)
    created.setAutoCommit(false)
    AccountSql.initialize(created)
    ImperativeAccountSql.initialize(created)
    IndexingPreferenceSql.initialize(created)
    created.commit()
    created
  }
  override def afterAll(): Unit = {
    opened.foreach(_.close())
    super.afterAll()
  }
  private def empty(c: Connection): Unit = {
    Using.resource(c.createStatement())(_.execute("""TRUNCATE ponygirls_imperative_users,ponygirls_imperative_enrollments,
      ponygirls_account_users,ponygirls_account_sessions,ponygirls_account_tokens,ponygirls_indexing_preferences"""))
    c.commit()
  }
  protected def withStorage(body: AccountStorage => Unit): Unit = {
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
    try body(new SharedAccountStorage(transactions, (_, fingerprints) => fingerprints)) finally empty(c)
  }
}
