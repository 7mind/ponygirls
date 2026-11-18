package ponygirls.auth

import java.nio.file.Files
import java.sql.{Connection, DriverManager}
import java.time.{Clock, Duration, Instant, ZoneOffset}
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
  private def awaitWaiting(waiters: Int): Unit = {
    val deadline = System.nanoTime() + 10.seconds.toNanos
    var blocked = 0
    while (blocked < waiters && System.nanoTime() < deadline) {
      Using.resource(connection()) { observer =>
        blocked = scalar(observer, "SELECT count(*) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0")
      }
      if (blocked < waiters) Thread.sleep(10)
    }
    assertEquals(blocked, waiters, "transactions must really be waiting for locks")
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

  private val imperativePassword = "synthetic imperative password"
  private val totpSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private val raceStart = Instant.parse("2026-01-01T00:00:00Z")
  private val keyDirectory = Files.createTempDirectory("account-race-")
  private lazy val settings: Option[ImperativeSettings] = {
    val key = keyDirectory.resolve("totp-key")
    Files.writeString(key, Secrets.generate())
    Some(ImperativeSettings("race", true, false, false, 100, Duration.ofHours(24), "Race", Set.empty, TotpVault.load(key, "race")))
  }
  override def afterAll(): Unit = {
    Files.list(keyDirectory).forEach(Files.delete(_))
    Files.delete(keyDirectory)
  }
  private def resetImperative(declared: DeclaredDirectory): Unit = Using.resource(connection()) { setup =>
    AccountSql.initialize(setup)
    ImperativeAccountSql.initialize(setup)
    Using.resource(setup.createStatement())(_.execute("""TRUNCATE ponygirls_account_users,ponygirls_account_sessions,ponygirls_account_tokens,
      ponygirls_imperative_users,ponygirls_imperative_enrollments"""))
    AccountSql.reconcile(setup, declared.users)
    setup.commit()
  }
  /** The imperative core as a Haystack-style adapter wires it: shared sessions and fingerprint history on the same connection. */
  private def imperative(c: Connection, declared: DeclaredDirectory, at: Instant): ImperativeAccounts = {
    val sessions = new SharedAccountSessions(c, owner => owner, () => ImperativeAccountSql.directory(c, settings, declared))
    ImperativeAccountSql.accounts(c, settings, declared, sessions, sessions, FastPasswordHasher, Clock.fixed(at, ZoneOffset.UTC))
  }
  private def code(at: Instant): String = Totp.code(Totp.decodeSecret(totpSecret).get, Totp.stepAt(at))
  private def signup(c: Connection, declared: DeclaredDirectory, name: String, at: Instant): AccountOutcome[SignupResult] =
    imperative(c, declared, at).signup(name, s"$name@example.test", NewCredentials(imperativePassword, totpSecret, code(at), false), None)
  private def signedIn[A](outcome: AccountOutcome[A]): SignedIn = outcome match {
    case AccountOutcome.Completed(SignupResult.Active(result)) => result
    case AccountOutcome.Completed(result: SignedIn) => result
    case other => fail(s"expected a session, got $other")
  }
  private def fingerprints(c: Connection, ids: String*): Int =
    scalar(c, ids.map(id => s"'$id'").mkString("SELECT count(*) FROM ponygirls_account_users WHERE id IN (", ",", ")"))

  test("Effectual GoodCommunication regression (C4): a stale reconciliation leaves imperative accounts alone; a declared name and a signup of it serialise") {
    val current = DeclaredDirectory(Vector(declared("adam"), declared("bert")), Set.empty)
    val stale = Vector(declared("adam"))
    resetImperative(current)
    val later = raceStart.plusSeconds(Totp.StepSeconds)
    val (original, token) = Using.resource(connection()) { c =>
      val ivy = signedIn(signup(c, current, "ivy", raceStart))
      val issued = AccountSql.issue(c, ImperativeAccountSql.directory(c, settings, current), ivy.session.credential, "Ivy client")
      c.commit()
      (ivy, issued)
    }
    val executor = Executors.newSingleThreadExecutor()
    try Using.resource(connection()) { recovering =>
      val recovered = signedIn(imperative(recovering, current, later).recover("ivy", code(later), "synthetic recovered password", None))
      Using.resource(connection()) { creating =>
        val pid = scalar(creating, "SELECT pg_backend_pid()")
        val created = signedIn(signup(creating, current, "newbie", later))
        val reconciling = executor.submit(committed(c => AccountSql.reconcile(c, stale)))
        awaitBlockedBy(pid, 1)
        creating.commit()
        // It completes while the recovery still holds the imperative owner's lock and rows.
        assertEquals(reconciling.get(10, TimeUnit.SECONDS), Right(()))
        recovering.commit()
        Using.resource(connection()) { observer =>
          val directory = ImperativeAccountSql.directory(observer, settings, DeclaredDirectory(stale, Set.empty))
          assertEquals(Vector(original, recovered, created).map(signed => AccountSql.browser(observer, directory, signed.session.secret).map(_.userId)),
            Vector(None, Some("ivy"), Some("newbie")))
          assertEquals(AccountSql.bearer(observer, directory, token.secret).map(_.userId), Some("ivy"))
          assertEquals(new PostgresImperativeUsers(observer).user("ivy").map(_.passwordHash), recovered.user.passwordHash)
          assertEquals((fingerprints(observer, "ivy", "newbie"), scalar(observer, "SELECT count(*) FROM ponygirls_account_users WHERE id='bert' AND NOT enabled")), (0, 1))
        }
      }
    } finally executor.shutdownNow()

    def withName(name: String): DeclaredDirectory = DeclaredDirectory(current.users :+ declared(name), Set.empty)
    def install(c: Connection, directory: DeclaredDirectory): Unit = ImperativeAccountSql.installDeclared(c, directory)(AccountSql.reconcile(c, directory.users))
    val racing = Executors.newSingleThreadExecutor()
    try {
      Using.resource(connection()) { creating =>
        val pid = scalar(creating, "SELECT pg_backend_pid()")
        signedIn(signup(creating, current, "zed", later))
        val installing = racing.submit(committed(c => install(c, withName("zed"))))
        awaitBlockedBy(pid, 1)
        creating.commit()
        assertEquals(installing.get(10, TimeUnit.SECONDS).left.toOption.collect { case AccountFailure(code) => code }, Some("config"))
      }
      Using.resource(connection()) { installing =>
        val pid = scalar(installing, "SELECT pg_backend_pid()")
        install(installing, withName("yan"))
        val creating = racing.submit(committed(c => signup(c, current, "yan", later)))
        awaitBlockedBy(pid, 1)
        installing.commit()
        assertEquals(creating.get(10, TimeUnit.SECONDS), Right(AccountOutcome.Rejected(AccountRejection.UsernameUnavailable, None)))
      }
      Using.resource(connection()) { observer =>
        val users = new PostgresImperativeUsers(observer)
        assertEquals((users.user("zed").map(_.status), users.user("yan"), fingerprints(observer, "zed"), fingerprints(observer, "yan")),
          (Some(AccountStatus.Active), None, 0, 1))
      }
    } finally racing.shutdownNow()
  }

  test("Effectual GoodCommunication regression (C5): an admin mutation, a login replacement across owner classes and a full reconciliation complete without a deadlock") {
    val adamPassword = "synthetic admin password"
    val adam = declared("adam").copy(passwordHash = Some(FastPasswordHasher.hash(adamPassword.toCharArray)))
    val current = DeclaredDirectory(Vector(adam, declared("bert"), declared("dora")), Set("adam"))
    resetImperative(current)
    val (ivy, admin) = Using.resource(connection()) { c =>
      val ivy = signedIn(signup(c, current, "ivy", raceStart))
      val admin = AccountSql.establish(c, ImperativeAccountSql.directory(c, settings, current), "adam", None).session
      c.commit()
      (ivy, admin)
    }
    val executor = Executors.newFixedThreadPool(3)
    try Using.resource(connection()) { holder =>
      val pid = scalar(holder, "SELECT pg_backend_pid()")
      new PostgresAccounts(holder).lockOwner("bert")
      // Holds the directory lock and adam, then waits for bert.
      val reconciling = executor.submit(committed(c => AccountSql.reconcile(c, current.users :+ declared("erin"))))
      awaitBlockedBy(pid, 1)
      // Waits for adam before it may take ivy.
      val promoting = executor.submit(committed(c => imperative(c, current, raceStart).setAdmin(admin.credential, "ivy", true, adamPassword)))
      awaitWaiting(2)
      // Takes dora, then ivy: neither waiter may hold ivy.
      val replacing = executor.submit(committed(c =>
        AccountSql.loginReplacing(c, ImperativeAccountSql.directory(c, settings, current), "dora", "synthetic-race-password", Some(ivy.session.secret))))
      val replacement = replacing.get(10, TimeUnit.SECONDS)
      assertEquals(replacement.map(_.replaced.map(_.userId)), Right(Some("ivy")))
      holder.commit()
      assertEquals(reconciling.get(10, TimeUnit.SECONDS), Right(()))
      assertEquals(promoting.get(10, TimeUnit.SECONDS), Right(AccountOutcome.Completed(())))
      Using.resource(connection()) { observer =>
        val directory = ImperativeAccountSql.directory(observer, settings, current)
        assertEquals((new PostgresImperativeUsers(observer).user("ivy").map(_.admin), fingerprints(observer, "erin")), (Some(true), 1))
        assertEquals(Vector(ivy.session, replacement.toOption.get.session).map(session => AccountSql.browser(observer, directory, session.secret).map(_.userId)),
          Vector(None, Some("dora")))
      }
    } finally executor.shutdownNow()
  }
}
