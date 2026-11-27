package ponygirls.auth.http4s

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import io.circe.Json
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.sql.{Connection, DriverManager}
import java.time.Duration
import java.util.concurrent.atomic.AtomicReference
import ponygirls.auth.*
import ponygirls.auth.boundary.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** Communication on the shared PostgreSQL tables, with bearer secrets refused as passwords: a wrong or refused sign-in does
  * no session work. Writes to the session table are counted by a trigger into a sequence, which a rollback does not undo;
  * an owner's lock is held by another connection, so that taking it would fail the attempt (`lock_timeout`) instead of
  * answering `unauthorized`. */
final class PostgresDeclaredRefusalSuite extends munit.FunSuite {
  private given IORuntime = FrozenTime.runtime
  private val Password = "synthetic-refusal-password-not-a-secret"
  private val CarolPassword = "synthetic-refusal-carol-password"
  private val Token = Secrets.generate()
  private val TotpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
  private val directory = Files.createTempDirectory("declared-refusal-")
  private def file(name: String, value: String): String = Files.writeString(directory.resolve(name), value, StandardCharsets.UTF_8).toString
  private def connect(): Connection = {
    val jdbc = sys.env.getOrElse("ACCOUNT_TEST_JDBC",
      fail("PostgreSQL required: run shared/service-auth/scripts/test-postgres.sh or nix/tests/shared-jvm.sh, which own the database and set ACCOUNT_TEST_JDBC"))
    DriverManager.getConnection(jdbc, "account_test", "synthetic-test-password")
  }
  private def execute(c: Connection, sql: String): Unit = Using.resource(c.createStatement())(_.execute(sql))
  private val Tables = """ponygirls_imperative_users,ponygirls_imperative_enrollments,ponygirls_account_users,ponygirls_account_sessions,
    ponygirls_account_tokens,ponygirls_indexing_preferences"""
  override def afterAll(): Unit = {
    val paths = Files.walk(directory)
    try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  }

  private final class Fixture(val c: Connection, holder: Connection, val service: DeclarativeAccountService[ChatSnapshot],
      val current: AtomicReference[ChatSnapshot], val on: ChatSnapshot, val settings: ImperativeSettings) {
    /** The probe's next value; a probe read moves it by one. */
    def writes(): Long = Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT nextval('session_writes_probe')")) { r =>
      r.next(); r.getLong(1)
    })
    /** Another connection holds the owner's lock; taking it fails after `lock_timeout`. */
    def hold(owner: String): Unit = execute(holder, s"SELECT pg_advisory_lock(hashtextextended('ponygirls-account:$owner',71393723))")
    def release(): Unit = execute(holder, "SELECT pg_advisory_unlock_all()")
  }
  private def fixture(body: Fixture => Unit): Unit = {
    val c = connect()
    val holder = connect()
    try {
      c.setAutoCommit(false)
      holder.setAutoCommit(true)
      AccountSql.initialize(c)
      ImperativeAccountSql.initialize(c)
      IndexingPreferenceSql.initialize(c)
      execute(c, s"TRUNCATE $Tables")
      execute(c, "CREATE SEQUENCE IF NOT EXISTS session_writes_probe")
      execute(c, "CREATE OR REPLACE FUNCTION session_writes_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('session_writes_probe'); RETURN NULL; END $$")
      execute(c, "DROP TRIGGER IF EXISTS session_writes_probe ON ponygirls_account_sessions")
      execute(c, "CREATE TRIGGER session_writes_probe AFTER INSERT OR UPDATE OR DELETE ON ponygirls_account_sessions FOR EACH ROW EXECUTE FUNCTION session_writes_probe()")
      c.commit()
      val transactions = new ConnectionTransactions {
        def transaction[A](work: Connection => A): IO[A] = IO.blocking(c.synchronized {
          try {
            val result = work(c)
            c.commit()
            result
          } catch { case failure: Throwable => c.rollback(); throw failure }
        })
        def afterCommit(failure: Throwable): Boolean = false
      }
      val hash = file("password", ponygirls.auth.Password.hash(Password.toCharArray))
      // Dora's password is Alice's configured token.
      val declared = DeclaredUsers.load(Vector(
        DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("laptop", file("alice.sha", Secrets.digest(Token)))), Some("alice"), Some(hash),
          true, true),
        DeclaredUserConfig("bob", "human", "Bob", Vector.empty, Some("bob"), Some(hash), true, false),
        DeclaredUserConfig("dora", "human", "Dora", Vector.empty, Some("dora"), Some(file("dora", ponygirls.auth.Password.hash(Token.toCharArray))), true, false)),
        DeclaredIdRules.Blabber, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
      val policy = OriginPolicy.load(Vector("chat.test"), Vector("https://chat.test:8448"), Vector.empty, cookieSecure = true).fold(r => fail(s"refused: $r"), identity)
      val off = ChatSnapshot(declared.users, declared.directory, None, declared.tokens, policy, Set.empty)
      val settings = ImperativeSettings("chat", true, false, false, 10, Duration.ofHours(24), "Chat", Set.empty,
        TotpVault.load(Path.of(file("totp.key", Secrets.generate())), "chat"))
      val on = off.copy(imperative = Some(settings))
      val current = new AtomicReference[ChatSnapshot](off)
      val (runtime, release) = ImperativeRuntime.resource(FrozenTime.clock, PasswordHasher.Pbkdf2).allocated.unsafeRunSync()
      try {
        val service = new DeclarativeAccountService[ChatSnapshot](new SharedAccountStorage(transactions, (_, fingerprints) => fingerprints), () => current.get,
          runtime, IndexingService.Blabber, IndexingPolicy.defaults, BearerSecretPasswords.Refused, DeclaredInstallation.Reconciled, AccountLifecycle.Unobserved)
        service.install(off).unsafeRunSync()
        body(new Fixture(c, holder, service, current, on, settings))
      } finally release.unsafeRunSync()
    } finally {
      try {
        c.rollback()
        execute(c, "DROP TRIGGER IF EXISTS session_writes_probe ON ponygirls_account_sessions")
        execute(c, "DROP FUNCTION IF EXISTS session_writes_probe()")
        execute(c, "DROP SEQUENCE IF EXISTS session_writes_probe")
        execute(c, s"TRUNCATE $Tables")
        c.commit()
      } finally {
        c.close()
        holder.close()
      }
    }
  }
  private def loginBody(login: String, password: String): Json = Json.obj("login" -> Json.fromString(login), "password" -> Json.fromString(password))

  test("a refused bearer secret and a wrong password both fail before any session write or owner lock, with the same failure") { fixture { f =>
    val previous = f.service.login("bob", Password, None).unsafeRunSync().session.secret
    f.hold("dora")
    execute(f.c, "SET lock_timeout = '200ms'")
    f.c.commit()
    val before = f.writes()
    val refused = intercept[AccountFailure](f.service.login("dora", Token, Some(previous)).unsafeRunSync())
    val wrong = intercept[AccountFailure](f.service.login("dora", "synthetic-wrong-password", Some(previous)).unsafeRunSync())
    assert((refused, wrong) == (AccountFailure("unauthorized"), AccountFailure("unauthorized")), "the two refusals differ")
    // Two probe reads in between: the counter moved by them alone.
    assert(f.writes() == before + 1, "a refused sign-in wrote to the session table")
    f.c.commit()
    assertEquals(f.service.resolve(_ => Presented(previous, true, true)).unsafeRunSync().authority.userId, "bob")
    // The probe counts: a sign-in that replaces a session inserts one row and deletes one.
    f.release()
    val counted = f.writes()
    f.service.login("bob", Password, Some(previous)).unsafeRunSync()
    assert(f.writes() == counted + 3, "the probe did not count a sign-in's writes")
    f.c.commit()
  }}
  test("an imperative sign-in that is wrong or refused, with an earlier cookie, neither reads nor locks that session's owner") { fixture { f =>
    val code = Totp.code(Totp.decodeSecret(TotpSecret).getOrElse(fail("secret")), Totp.stepAt(FrozenTime.Now))
    val signup = Json.obj("username" -> Json.fromString("carol"), "email" -> Json.fromString("carol@example.test"), "password" -> Json.fromString(CarolPassword),
      "totpSecret" -> Json.fromString(TotpSecret), "totpCode" -> Json.fromString(code), "requireTotp" -> Json.False)
    f.current.set(f.on)
    val previous = f.service.login("bob", Password, None).unsafeRunSync().session.secret
    assertEquals(f.service.imperativeRequest(f.on, f.settings, "POST", "/signup", Some(signup), Vector.empty, None, "client-a").unsafeRunSync().status, 200)
    f.hold("bob")
    execute(f.c, "SET lock_timeout = '200ms'")
    f.c.commit()
    val before = f.writes()
    Vector("synthetic-wrong-password", Token).foreach { password =>
      assertEquals(f.service.imperativeLogin(f.on, f.settings, loginBody("carol", password), Some(previous), "client-a").unsafeRunSync().status, 401)
    }
    assert(f.writes() == before + 1, "a refused sign-in wrote to the session table")
    f.c.commit()
    f.release()
    assertEquals(f.service.imperativeLogin(f.on, f.settings, loginBody("carol", CarolPassword), Some(previous), "client-a").unsafeRunSync().status, 200)
    assertEquals(intercept[AccountRefused](f.service.resolve(_ => Presented(previous, true, true)).unsafeRunSync()).refusal, AccountRefusal.InvalidCredentials)
  }}
}
