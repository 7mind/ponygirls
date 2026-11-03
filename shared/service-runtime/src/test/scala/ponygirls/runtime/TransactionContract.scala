package ponygirls.runtime

import cats.effect.{IO, Ref, Resource}
import cats.effect.unsafe.implicits.global
import munit.FunSuite
import java.nio.file.Files
import java.sql.Connection
import scala.concurrent.duration.*
import scala.util.Using

/** Narrow business-level test seam, not a fake SQL engine. Both adapters exercise
  * exactly the same commit/rollback laws; exact JDBC concurrency stays in PG suite.
  */
trait Counter {
  def change(amount: Int, reject: Boolean): IO[Int]
  def value: IO[Int]
}
abstract class TransactionContract extends FunSuite {
  def counter: Resource[IO, Counter]
  test("successful transaction commits and returns its result") {
    counter.use(c => for {
      a <- c.change(4, false)
      b <- c.change(3, false)
      actual <- c.value
      _ <- IO { assertEquals(a, 4); assertEquals(b, 7); assertEquals(actual, 7) }
    } yield ()).timeout(20.seconds).unsafeRunSync()
  }
  test("failed transaction preserves prior committed state") {
    counter.use(c => for {
      _ <- c.change(4, false)
      rejected <- c.change(3, true).attempt
      actual <- c.value
      _ <- IO { assert(rejected.isLeft); assertEquals(actual, 4) }
    } yield ()).timeout(20.seconds).unsafeRunSync()
  }
}
// Behavioral/Active/Blackbox/Atomic: manually implemented transactional dummy.
final class DummyTransactionContract extends TransactionContract {
  def counter: Resource[IO, Counter] = Resource.eval(Ref.of[IO, Int](0).map { state => new Counter {
    def value: IO[Int] = state.get
    def change(amount: Int, reject: Boolean): IO[Int] =
      if (reject) IO.raiseError(new IllegalStateException("rejected")) else state.updateAndGet(_ + amount)
  } })
}

object PostgresFixture {
  def config: Resource[IO, JdbcConfig] = Resource.make(IO.blocking {
    val url = sys.env.getOrElse("RUNTIME_TEST_JDBC", throw new IllegalStateException("RUNTIME_TEST_JDBC required; run shared/service-runtime/scripts/test-postgres.sh in pinned shell"))
    val path = Files.createTempFile("runtime-password-", ".txt")
    Files.writeString(path, "runtime-test-password\n")
    JdbcConfig(url, "postgres", path, JdbcLimits(2, 4, 1.second, 2.seconds, 3.seconds, 200.millis, 2.seconds, 5.seconds))
  })(c => IO.blocking(Files.deleteIfExists(c.passwordFile)).void)
  def database: Resource[IO, JdbcDatabase] = config.flatMap(JdbcDatabase.resource)
  def execute(c: Connection, sql: String): Unit = Using.resource(c.createStatement())(_.execute(sql))
  def integer(c: Connection, sql: String): Int = Using.resource(c.createStatement()) { p => Using.resource(p.executeQuery(sql)) { r => r.next(); r.getInt(1) } }
}
// Behavioral/Active/Blackbox/Good-Communication: same contract, real transactions.
final class PostgresTransactionContract extends TransactionContract {
  import PostgresFixture.*
  def counter: Resource[IO, Counter] = database.evalMap { db =>
    db.transaction(c => { execute(c, "DROP TABLE IF EXISTS runtime_counter"); execute(c, "CREATE TABLE runtime_counter(value integer NOT NULL)"); execute(c, "INSERT INTO runtime_counter VALUES(0)") }).as(new Counter {
      def value: IO[Int] = db.transaction(c => integer(c, "SELECT value FROM runtime_counter"))
      def change(amount: Int, reject: Boolean): IO[Int] = db.transaction { c =>
        Using.resource(c.prepareStatement("UPDATE runtime_counter SET value=value+?")) { p => p.setInt(1, amount); p.executeUpdate() }
        if (reject) throw new IllegalStateException("rejected")
        integer(c, "SELECT value FROM runtime_counter")
      }
    })
  }
}

// Same abstract commit/rollback laws against the synchronous facade and real PG.
final class BlockingPostgresTransactionContract extends TransactionContract {
  import PostgresFixture.*
  def counter: Resource[IO, Counter] = config.flatMap(cfg => Resource.make(IO.blocking(new BlockingJdbcDatabase(cfg)))(db => IO.blocking(db.close()))).evalMap { db =>
    IO.blocking(db.transaction(c => { execute(c, "DROP TABLE IF EXISTS runtime_counter"); execute(c, "CREATE TABLE runtime_counter(value integer NOT NULL)"); execute(c, "INSERT INTO runtime_counter VALUES(0)") })).as(new Counter {
      def value: IO[Int] = IO.blocking(db.transaction(c => integer(c, "SELECT value FROM runtime_counter")))
      def change(amount: Int, reject: Boolean): IO[Int] = IO.blocking(db.transaction { c =>
        Using.resource(c.prepareStatement("UPDATE runtime_counter SET value=value+?")) { p => p.setInt(1, amount); p.executeUpdate() }
        if (reject) throw new IllegalStateException("rejected")
        integer(c, "SELECT value FROM runtime_counter")
      })
    })
  }
}
