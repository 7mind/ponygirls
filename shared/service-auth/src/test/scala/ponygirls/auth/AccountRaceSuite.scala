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
  private def awaitBlockedBy(holder: Int, waiters: Int): Unit = {
    val deadline = System.nanoTime() + 10.seconds.toNanos
    var blocked = 0
    while (blocked < waiters && System.nanoTime() < deadline) {
      Using.resource(connection()) { observer =>
        blocked = scalar(observer, s"SELECT count(*) FROM pg_stat_activity WHERE $holder=ANY(pg_blocking_pids(pid))")
      }
      if (blocked < waiters) Thread.sleep(10)
    }
    assertEquals(blocked, waiters, "transactions must really be waiting behind the holder")
  }
  private def committed[A](body: Connection => A): Callable[Either[Throwable, A]] = () => Using.resource(connection()) { c =>
    try { val result = body(c); c.commit(); Right(result) }
    catch { case scala.util.control.NonFatal(error) => c.rollback(); Left(error) }
  }
  private lazy val raceHash = Password.hash("synthetic-race-password".toCharArray)
  private def declared(id: String): AccountUser = AccountUser(id, "human", id, Some(id), Some(raceHash), true, AccountOrigin.Declarative)
  private def reset(users: Vector[AccountUser]): Unit = Using.resource(connection()) { setup =>
    AccountSql.initialize(setup)
    Using.resource(setup.createStatement())(_.execute("TRUNCATE ponygirls_account_users,ponygirls_account_sessions,ponygirls_account_tokens"))
    AccountSql.reconcile(setup, users)
    setup.commit()
  }

  test("Effectual GoodCommunication regression: a reconciliation waiting behind another one also reconciles the owners that one added") {
    reset(Vector(declared("alice")))
    val withCarol = Vector(declared("alice"), declared("carol"))
    val withBob = Vector(declared("alice"), declared("bob"))
    val executor = Executors.newSingleThreadExecutor()
    try Using.resource(connection()) { holder =>
      val pid = scalar(holder, "SELECT pg_backend_pid()")
      AccountSql.reconcile(holder, withCarol)
      val carol = AccountSql.login(holder, withCarol, "carol", "synthetic-race-password")
      AccountSql.issue(holder, withCarol, carol.credential, "Carol client")
      val waiting = executor.submit(committed(c => AccountSql.reconcile(c, withBob)))
      awaitBlockedBy(pid, 1)
      holder.commit()
      assertEquals(waiting.get(10, TimeUnit.SECONDS), Right(()))
      Using.resource(connection()) { observer =>
        assertEquals(scalar(observer, "SELECT count(*) FROM ponygirls_account_users WHERE enabled"), 2)
        assertEquals(scalar(observer, "SELECT count(*) FROM ponygirls_account_users WHERE id='carol' AND NOT enabled"), 1)
        assertEquals(scalar(observer, "SELECT count(*) FROM ponygirls_account_sessions WHERE owner='carol'"), 0)
        assertEquals(scalar(observer, "SELECT count(*) FROM ponygirls_account_tokens WHERE owner='carol' AND NOT revoked"), 0)
      }
    } finally executor.shutdownNow()
  }

  test("Effectual GoodCommunication regression: login replacement locks the previous session's owner before that session becomes current") {
    val renamed = Vector(declared("alice").copy(login = Some("alice-renamed")), declared("bob"))
    val restored = Vector(declared("alice"), declared("bob"))
    reset(renamed)
    val previous = Using.resource(connection()) { c =>
      val session = AccountSql.login(c, renamed, "alice-renamed", "synthetic-race-password")
      c.commit()
      session
    }
    val executor = Executors.newFixedThreadPool(2)
    try Using.resource(connection()) { holder =>
      val pid = scalar(holder, "SELECT pg_backend_pid()")
      AccountSql.reconcile(holder, restored)
      val replacing = executor.submit(committed(c => AccountSql.loginReplacing(c, restored, "bob", "synthetic-race-password", Some(previous.secret))))
      awaitBlockedBy(pid, 1)
      val ordered = executor.submit(committed { c =>
        val owners = new PostgresAccounts(c)
        owners.lockOwner("alice")
        owners.lockOwner("bob")
      })
      awaitBlockedBy(pid, 2)
      holder.commit()
      val replacement = replacing.get(10, TimeUnit.SECONDS)
      assertEquals(ordered.get(10, TimeUnit.SECONDS), Right(()))
      assertEquals(replacement.map(_.replaced.map(_.userId)), Right(Some("alice")))
    } finally executor.shutdownNow()
  }

  Vector("removed", "disabled", "password").foreach { boundary =>
  test(s"Effectual GoodCommunication regression: password login waiting behind $boundary cannot re-create authority") {
    val hash = Password.hash("synthetic-race-password".toCharArray)
    val users = Vector(AccountUser("alice", "human", "Alice", Some("alice"), Some(hash), true, AccountOrigin.Declarative))
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
