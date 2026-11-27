package ponygirls.auth.http4s

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.sql.{Connection, DriverManager}
import ponygirls.auth.*
import ponygirls.auth.boundary.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** Communication on the shared PostgreSQL tables: a declared password that is a configured bearer secret is refused on the
  * path of a wrong password, before any session work. Writes to the session table are counted by a trigger into a
  * sequence, which a rollback does not undo; the owner's lock is held by another connection, so that taking it would
  * fail the attempt (`lock_timeout`) instead of answering `unauthorized`. */
final class PostgresDeclaredRefusalSuite extends munit.FunSuite {
  private given IORuntime = FrozenTime.runtime
  private val Password = "synthetic-refusal-password-not-a-secret"
  private val Token = Secrets.generate()
  private val directory = Files.createTempDirectory("declared-refusal-")
  private def file(name: String, value: String): String = Files.writeString(directory.resolve(name), value, StandardCharsets.UTF_8).toString
  private def connect(): Connection = {
    val jdbc = sys.env.getOrElse("ACCOUNT_TEST_JDBC",
      fail("PostgreSQL required: run shared/service-auth/scripts/test-postgres.sh or nix/tests/shared-jvm.sh, which own the database and set ACCOUNT_TEST_JDBC"))
    DriverManager.getConnection(jdbc, "account_test", "synthetic-test-password")
  }
  private def execute(c: Connection, sql: String): Unit = Using.resource(c.createStatement())(_.execute(sql))
  private def writes(c: Connection): Long = Using.resource(c.createStatement())(s => Using.resource(s.executeQuery("SELECT nextval('session_writes_probe')")) { r =>
    r.next(); r.getLong(1)
  })
  override def afterAll(): Unit = {
    val paths = Files.walk(directory)
    try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  }

  test("a refused bearer secret and a wrong password both fail before any session write or owner lock, with the same failure") {
    val c = connect()
    val holder = connect()
    try {
      c.setAutoCommit(false)
      AccountSql.initialize(c)
      ImperativeAccountSql.initialize(c)
      IndexingPreferenceSql.initialize(c)
      execute(c, """TRUNCATE ponygirls_imperative_users,ponygirls_imperative_enrollments,ponygirls_account_users,ponygirls_account_sessions,
        ponygirls_account_tokens,ponygirls_indexing_preferences""")
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
      }
      val hash = file("password", ponygirls.auth.Password.hash(Password.toCharArray))
      // Dora's password is Alice's configured token.
      val declared = DeclaredUsers.load(Vector(
        DeclaredUserConfig("alice", "human", "Alice", Vector(DeclaredTokenConfig("laptop", file("alice.sha", Secrets.digest(Token)))), None, None, true, false),
        DeclaredUserConfig("bob", "human", "Bob", Vector.empty, Some("bob"), Some(hash), true, false),
        DeclaredUserConfig("dora", "human", "Dora", Vector.empty, Some("dora"), Some(file("dora", ponygirls.auth.Password.hash(Token.toCharArray))), true, false)),
        DeclaredIdRules.Blabber, DigestRead.Snapshot, DigestReader.Stream).fold(r => fail(s"refused: $r"), identity)
      val snapshot = ChatSnapshot(declared.users, declared.directory, None, declared.tokens, Set.empty)
      val (runtime, release) = ImperativeRuntime.resource(FrozenTime.clock, PasswordHasher.Pbkdf2).allocated.unsafeRunSync()
      try {
        val service = new DeclarativeAccountService[ChatSnapshot](new SharedAccountStorage(transactions, (_, fingerprints) => fingerprints), () => snapshot,
          runtime, IndexingService.Blabber, IndexingPolicy.defaults, BearerSecretPasswords.Refused, DeclaredInstallation.Reconciled, AccountLifecycle.Unobserved)
        service.install(snapshot).unsafeRunSync()
        val previous = service.login("bob", Password, None).unsafeRunSync().session.secret
        holder.setAutoCommit(true)
        execute(holder, "SELECT pg_advisory_lock(hashtextextended('ponygirls-account:dora',71393723))")
        execute(c, "SET lock_timeout = '200ms'")
        c.commit()
        val before = writes(c)
        val refused = intercept[AccountFailure](service.login("dora", Token, Some(previous)).unsafeRunSync())
        val wrong = intercept[AccountFailure](service.login("dora", "synthetic-wrong-password", Some(previous)).unsafeRunSync())
        assertEquals((refused, wrong), (AccountFailure("unauthorized"), AccountFailure("unauthorized")))
        // Two probe reads in between: the counter moved by them alone.
        assertEquals(writes(c), before + 1)
        c.commit()
        assertEquals(service.resolve(_ => Presented(previous, true, true)).unsafeRunSync().authority.userId, "bob")
        // The probe counts: a sign-in that replaces a session inserts one row and deletes one.
        execute(holder, "SELECT pg_advisory_unlock_all()")
        val counted = writes(c)
        service.login("bob", Password, Some(previous)).unsafeRunSync()
        assertEquals(writes(c), counted + 3)
        c.commit()
      } finally release.unsafeRunSync()
    } finally {
      try {
        c.rollback()
        execute(c, "DROP TRIGGER IF EXISTS session_writes_probe ON ponygirls_account_sessions")
        execute(c, "DROP FUNCTION IF EXISTS session_writes_probe()")
        execute(c, "DROP SEQUENCE IF EXISTS session_writes_probe")
        execute(c, """TRUNCATE ponygirls_imperative_users,ponygirls_imperative_enrollments,ponygirls_account_users,ponygirls_account_sessions,
          ponygirls_account_tokens,ponygirls_indexing_preferences""")
        c.commit()
      } finally {
        c.close()
        holder.close()
      }
    }
  }
}
