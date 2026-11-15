package ponygirls.auth

import java.sql.{Connection, DriverManager}
import java.util.concurrent.{Callable, Executors, TimeUnit}
import scala.util.Using
import scala.concurrent.duration.*

final class AccountRaceSuite extends munit.FunSuite {
  override val munitTimeout = 60.seconds
  private def connection(): Connection = {
    val jdbc = sys.env.get("ACCOUNT_TEST_JDBC")
    if (jdbc.isEmpty) {
      assert(!sys.env.contains("ACCOUNT_REQUIRE_POSTGRES"), "PostgreSQL required")
      assume(false, "PostgreSQL explicitly skipped: use shared/service-auth/scripts/test-postgres.sh")
    }
    val result = DriverManager.getConnection(jdbc.get, "account_test", "synthetic-test-password")
    result.setAutoCommit(false)
    result
  }
  private def scalar(c: Connection, sql: String): Int = Using.resource(c.createStatement()) { statement =>
    Using.resource(statement.executeQuery(sql)) { result => assert(result.next()); result.getInt(1) }
  }
  Vector("removed", "disabled", "password").foreach { boundary =>
  test(s"Effectual GoodCommunication regression: password login waiting behind $boundary cannot re-create authority") {
    val hash = Password.hash("synthetic-race-password".toCharArray)
    val users = Vector(AccountUser("alice", "human", "Alice", Some("alice"), Some(hash), true))
    Using.resource(connection()) { setup =>
      AccountSql.initialize(setup)
      Using.resource(setup.createStatement())(_.execute("TRUNCATE ponygirls_account_sessions,ponygirls_account_tokens"))
      AccountSql.reconcile(setup, users)
      setup.commit()
    }
    val executor = Executors.newSingleThreadExecutor()
    try Using.resource(connection()) { holder =>
      new PostgresAccounts(holder).lockOwner("alice")
      val pid = scalar(holder, "SELECT pg_backend_pid()")
      val login = executor.submit(new Callable[Either[Throwable, AccountSession]] {
        def call(): Either[Throwable, AccountSession] = Using.resource(connection()) { waiting =>
          try {
            val session = AccountSql.login(waiting, users, "alice", "synthetic-race-password")
            waiting.commit()
            Right(session)
          } catch { case scala.util.control.NonFatal(error) => waiting.rollback(); Left(error) }
        }
      })
      val deadline = System.nanoTime() + 10.seconds.toNanos
      var blocked = false
      while (!blocked && System.nanoTime() < deadline) {
        Using.resource(connection()) { observer =>
          blocked = scalar(observer, s"SELECT count(*) FROM pg_stat_activity WHERE $pid=ANY(pg_blocking_pids(pid))") > 0
        }
        if (!blocked) Thread.sleep(10)
      }
      assert(blocked, "login must really be waiting behind the owner lock")
      val changed = boundary match {
        case "removed" => Vector.empty
        case "disabled" => users.map(_.copy(enabled = false))
        case _ => users.map(_.copy(passwordHash = Some(Password.hash("changed-race-password".toCharArray))))
      }
      AccountSql.reconcile(holder, changed)
      holder.commit()
      val outcome = login.get(10, TimeUnit.SECONDS)
      Using.resource(connection()) { restored =>
        AccountSql.reconcile(restored, users)
        restored.commit()
        outcome.foreach(session => assertEquals(AccountSql.browser(restored, users, session.secret), None,
          "the stale login secret revived after account restoration"))
      }
      assertEquals(outcome.left.toOption.map { case failure: AccountFailure => failure.code; case _ => "unexpected" }, Some("unauthorized"))
    } finally executor.shutdownNow()
  }
  }
}
