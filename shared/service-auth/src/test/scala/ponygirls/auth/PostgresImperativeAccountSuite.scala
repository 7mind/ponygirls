package ponygirls.auth

import java.sql.{Connection, DriverManager, SQLException}
import java.time.Instant
import scala.util.Using

/** The imperative-account contract on PostgreSQL: one connection for the suite, every contract transaction committed. */
final class PostgresImperativeAccountSuite extends ImperativeAccountContract {
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
    created.commit()
    created
  }
  override def afterAll(): Unit = {
    opened.foreach(_.close())
    super.afterAll()
  }

  protected def withBackend(body: ImperativeBackend => Unit): Unit = {
    val c = connection()
    Using.resource(c.createStatement())(_.execute("""TRUNCATE ponygirls_imperative_users,ponygirls_imperative_enrollments,
      ponygirls_account_users,ponygirls_account_sessions,ponygirls_account_tokens"""))
    c.commit()
    body(new ImperativeBackend {
      def transaction[A](work: (ImperativeUserRepository, AccountRepository) => A): A =
        try {
          val result = work(new PostgresImperativeUsers(c), new PostgresAccounts(c))
          c.commit()
          result
        } catch { case failure: Throwable => c.rollback(); throw failure }
    })
  }

  test("PostgreSQL: creation is insert-only and an enrollment digest is unique") {
    withBackend { backend =>
      val at = Instant.parse("2026-01-01T00:00:00Z")
      val row = StoredImperativeUser("alice", AccountStatus.Active, "alice@example.test", FastPasswordHasher.hash("synthetic password".toCharArray),
        SealedTotp("key", new Array[Byte](12), new Array[Byte](36)), 0L, false, false, FailureCounter.Clear, FailureCounter.Clear,
        FailureCounter.Clear, at, CreatedVia.Signup, None, None, None, at, at)
      backend.transaction((users, _) => users.insertUser(row))
      val duplicate = intercept[AccountFailure](backend.transaction((users, _) => users.insertUser(row.copy(email = "other@example.test"))))
      assertEquals((duplicate.code, backend.transaction((users, _) => users.user("alice")).map(_.email)), ("username-unavailable", Some(row.email)))
      val enrollment = StoredEnrollment("enrollment-1", Secrets.digest("code"), "bob", EnrollmentKind.Invite, "root", at, at.plusSeconds(60))
      backend.transaction((users, _) => users.putEnrollment(enrollment))
      intercept[SQLException](backend.transaction((users, _) => users.putEnrollment(enrollment.copy(id = "enrollment-2", username = "carol"))))
      assertEquals(backend.transaction((users, _) => users.enrollments), Vector(enrollment))
    }
  }
}
