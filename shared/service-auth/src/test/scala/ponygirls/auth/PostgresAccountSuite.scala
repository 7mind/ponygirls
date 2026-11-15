package ponygirls.auth

import java.sql.{Connection, DriverManager}
import scala.util.Using

final class PostgresAccountSuite extends AccountContract {
  override protected def withRepository(body: AccountRepository => Unit): Unit = {
    val jdbc = sys.env.get("ACCOUNT_TEST_JDBC")
    if (jdbc.isEmpty) {
      assert(!sys.env.contains("ACCOUNT_REQUIRE_POSTGRES"), "PostgreSQL required")
      assume(false, "PostgreSQL explicitly skipped: use shared/service-auth/scripts/test-postgres.sh")
    }
    Using.resource(DriverManager.getConnection(jdbc.get, "account_test", "synthetic-test-password")) { connection =>
      connection.setAutoCommit(false)
      try {
        AccountSql.initialize(connection)
        Using.resource(connection.createStatement())(_.execute("TRUNCATE ponygirls_account_sessions,ponygirls_account_tokens"))
        body(new PostgresAccounts(connection))
      } finally connection.rollback()
    }
  }
}
