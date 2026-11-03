package ponygirls.runtime

import cats.effect.{Deferred, IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.sql.Connection
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference
import munit.FunSuite
import scala.concurrent.duration.*
import scala.util.Using

// Behavioral/Active/Effectual/Good-Communication: PostgreSQL-specific semantics,
// intentionally not simulated by a second toy database. No DB skips in full gate.
final class PostgresSuite extends FunSuite {
  import PostgresFixture.*
  private def run[A](io: IO[A]): A = io.timeout(30.seconds).unsafeRunSync()
  private def scalar(c: Connection, sql: String): String = Using.resource(c.createStatement()) { p =>
    Using.resource(p.executeQuery(sql)) { r => r.next(); r.getString(1) }
  }
  test("connection-local server timeouts are explicit and enforced") {
    run(config.use { cfg => JdbcDatabase.resource(cfg.copy(limits = cfg.limits.copy(statementTimeout = 100.millis))).use { db => for {
      bounds <- db.transaction(c => List("statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout").map(name => scalar(c, s"SHOW $name")))
      _ <- IO(assertEquals(bounds, List("100ms", "200ms", "2s")))
      start <- IO.monotonic
      expired <- db.transaction(c => execute(c, "SELECT pg_sleep(2)")).attempt
      elapsed <- IO.monotonic.map(_ - start)
      _ <- IO {
        assertEquals(expired, Left(JdbcFailure("database-unavailable", Some("57014"))))
        assert(elapsed < 2.seconds, s"statement deadline elapsed $elapsed")
      }
      _ <- db.transaction(c => integer(c, "SELECT 1"))
    } yield () } })
  }
  test("required bounds preserve stricter PostgreSQL role timeouts in both facades") {
    run(config.use { cfg => JdbcDatabase.resource(cfg).use { db =>
      val configure = db.transaction(c => execute(c,"ALTER ROLE postgres SET statement_timeout='100ms'; ALTER ROLE postgres SET lock_timeout='75ms'; ALTER ROLE postgres SET idle_in_transaction_session_timeout='150ms'"))
      val check = for {
        values <- db.transaction(c => List("statement_timeout","lock_timeout","idle_in_transaction_session_timeout").map(name => scalar(c,s"SHOW $name")))
        sync <- IO.blocking(Using.resource(new BlockingJdbcDatabase(cfg))(b => b.transaction(c => List("statement_timeout","lock_timeout","idle_in_transaction_session_timeout").map(name => scalar(c,s"SHOW $name")))))
        _ <- IO { assertEquals(values,List("100ms","75ms","150ms")); assertEquals(sync,values) }
      } yield ()
      configure *> check.guarantee(db.transaction(c => execute(c,"ALTER ROLE postgres RESET statement_timeout; ALTER ROLE postgres RESET lock_timeout; ALTER ROLE postgres RESET idle_in_transaction_session_timeout")))
    } })
  }
  test("row lock waits are bounded and a failed transaction releases connection") {
    run(database.use { db => for {
      _ <- db.transaction(c => { execute(c, "DROP TABLE IF EXISTS runtime_lock"); execute(c, "CREATE TABLE runtime_lock(id int PRIMARY KEY, value int)"); execute(c, "INSERT INTO runtime_lock VALUES(1,0)") })
      locked = new CountDownLatch(1)
      finish = new CountDownLatch(1)
      blocker <- db.transaction { c => execute(c, "UPDATE runtime_lock SET value=1 WHERE id=1"); locked.countDown(); finish.await() }.start
      _ <- (for {
        _ <- IO.blocking(locked.await())
        start <- IO.monotonic
        rejected <- db.transaction(c => execute(c, "UPDATE runtime_lock SET value=2 WHERE id=1")).attempt
        elapsed <- IO.monotonic.map(_ - start)
        _ <- IO { assertEquals(rejected, Left(JdbcFailure("database-unavailable", Some("55P03")))); assert(elapsed < 2.seconds) }
      } yield ()).guarantee(IO(finish.countDown()))
      _ <- blocker.joinWithNever
      value <- db.transaction(c => integer(c, "SELECT value FROM runtime_lock"))
      _ <- IO(assertEquals(value, 1))
    } yield () })
  }
  test("driver errors do not reveal SQL, parameter, server diagnostics or cause") {
    run(database.use { db => for {
      error <- db.transaction(c => execute(c, "DO $$ BEGIN RAISE EXCEPTION 'secret-credential-and-user-content'; END $$")).attempt
      _ <- IO { error match {
        case Left(e: JdbcFailure) =>
          assertEquals(e.code, "database-unavailable")
          assertEquals(e.sqlState, Some("P0001"))
          assertEquals(e.getCause, null)
          assert(!e.toString.contains("secret"))
          assertEquals(e.getSuppressed.toList, Nil)
        case other => fail(s"expected safe JDBC failure: $other")
      } }
    } yield () })
  }
  test("rollback failure preserves safe secondary evidence for domain and SQL primary failures") {
    run(database.use { db => for {
      domain <- db.transaction { c =>
        try execute(c, "SELECT pg_terminate_backend(pg_backend_pid())") catch { case _: java.sql.SQLException => () }
        throw new IllegalStateException("domain-rejected")
      }.attempt
      driver <- db.transaction(c => execute(c, "SELECT pg_terminate_backend(pg_backend_pid())")).attempt
      _ <- IO {
        val primary = domain.swap.toOption.get
        assert(primary.isInstanceOf[IllegalStateException])
        assertEquals(primary.getMessage, "domain-rejected")
        List(primary, driver.swap.toOption.get).foreach { error =>
          val secondary = error.getSuppressed.toList
          assertEquals(secondary.size, 1, "terminated backend must retain rollback-failure evidence")
          secondary.head match {
            case safe: JdbcFailure =>
              assertEquals(safe.code, "database-rollback-failed")
              assertEquals(safe.getCause, null)
              assert(!safe.toString.contains("pg_terminate_backend"))
            case other => fail("unsafe secondary error type: " + other.getClass.getName)
          }
        }
        assert(driver.swap.toOption.get.isInstanceOf[JdbcFailure])
      }
    } yield () })
  }
  test("migration ledger applies exactly once concurrently and verifies full history") {
    run(database.use { db =>
      val ms = List(Migration(1, "create", "CREATE TABLE runtime_migrated(value int); INSERT INTO runtime_migrated VALUES(1)"), Migration(2, "increment", "UPDATE runtime_migrated SET value=value+1"))
      for {
        _ <- db.transaction(c => { execute(c, "DROP TABLE IF EXISTS runtime_migrated"); execute(c, "DROP TABLE IF EXISTS ponygirls_runtime_migrations") })
        _ <- (db.migrate("contract", ms), db.migrate("contract", ms)).parTupled
        _ <- db.migrate("contract", ms)
        value <- db.transaction(c => integer(c, "SELECT value FROM runtime_migrated"))
        count <- db.transaction(c => integer(c, "SELECT count(*) FROM ponygirls_runtime_migrations WHERE namespace='contract'"))
        _ <- IO { assertEquals(value, 2); assertEquals(count, 2) }
        mismatch <- db.migrate("contract", ms.updated(0, ms.head.copy(sql = "SELECT 1"))).attempt
        removed <- db.migrate("contract", ms.take(1)).attempt
        renamed <- db.migrate("contract", ms.updated(0, ms.head.copy(name = "renamed"))).attempt
        _ <- IO(List(mismatch, removed, renamed).foreach(r => assertEquals(r, Left(RuntimeFailure("migration-history-mismatch")))))
        _ <- db.migrate("independent", List(Migration(1, "other", "SELECT 1")))
      } yield ()
    })
  }
  test("migration failure rolls back SQL and ledger; corrected uncommitted migration can retry") {
    run(database.use { db => for {
      _ <- db.migrate("rollback", Nil)
      _ <- db.transaction(c => { execute(c, "DROP TABLE IF EXISTS runtime_failed_migration"); execute(c, "DELETE FROM ponygirls_runtime_migrations WHERE namespace='rollback'") })
      failure <- db.migrate("rollback", List(Migration(1, "bad", "CREATE TABLE runtime_failed_migration(id int); SELECT 1/0"))).attempt
      absent <- db.transaction(c => scalar(c, "SELECT to_regclass('runtime_failed_migration') IS NULL"))
      count <- db.transaction(c => integer(c, "SELECT count(*) FROM ponygirls_runtime_migrations WHERE namespace='rollback'"))
      _ <- IO { assert(failure.isLeft); assertEquals(absent, "t"); assertEquals(count, 0) }
      _ <- db.migrate("rollback", List(Migration(1, "fixed", "CREATE TABLE runtime_failed_migration(id int)")))
    } yield () })
  }
  test("cancel running JDBC does not release connection/admission until callback exits") {
    run(config.use { cfg => JdbcDatabase.resource(cfg.copy(limits = cfg.limits.copy(maxConnections = 1, maxQueued = 0))).use { db => for {
      entered = new CountDownLatch(1)
      finish = new CountDownLatch(1)
      connection = new AtomicReference[Connection]()
      active <- db.transaction { c => connection.set(c); entered.countDown(); finish.await(); 42 }.start
      _ <- IO.blocking(entered.await())
      cancelDone <- Deferred[IO, Unit]
      canceler <- (active.cancel *> cancelDone.complete(())).start
      _ <- (for {
        _ <- IO.sleep(100.millis)
        canceled <- cancelDone.tryGet
        full <- db.transaction(c => integer(c, "SELECT 1")).attempt
        _ <- IO { assertEquals(canceled, None); assert(!connection.get().isClosed); assertEquals(full, Left(RuntimeFailure("admission-full"))) }
      } yield ()).guarantee(IO(finish.countDown()))
      _ <- canceler.joinWithNever
      _ <- IO(assert(connection.get().isClosed))
      _ <- db.transaction(c => integer(c, "SELECT 1"))
    } yield () } })
  }
  test("resource shutdown drains live JDBC and prevents post-close transactions") {
    run(for {
      cfgAllocated <- config.allocated
      (cfg, clean) = cfgAllocated
      allocated <- JdbcDatabase.resource(cfg).allocated
      (db, close) = allocated
      entered = new CountDownLatch(1)
      finish = new CountDownLatch(1)
      active <- db.transaction { c => entered.countDown(); finish.await(); integer(c, "SELECT 1") }.start
      _ <- IO.blocking(entered.await())
      closed <- Deferred[IO, Unit]
      closer <- (close *> closed.complete(())).start
      _ <- (for {
        _ <- IO.sleep(50.millis)
        done <- closed.tryGet
        _ <- IO(assertEquals(done, None))
      } yield ()).guarantee(IO(finish.countDown()))
      _ <- active.joinWithNever
      _ <- closer.joinWithNever
      after <- db.transaction(c => integer(c, "SELECT 1")).attempt
      _ <- IO(assertEquals(after, Left(RuntimeFailure("runtime-closed"))))
      _ <- clean
    } yield ())
  }
  test("idle transaction bound terminates an abandoned transaction") {
    run(config.use { cfg => JdbcDatabase.resource(cfg.copy(limits = cfg.limits.copy(idleTransactionTimeout = 100.millis))).use { db =>
      db.transaction { c => integer(c, "SELECT 1"); Thread.sleep(400); integer(c, "SELECT 2") }.attempt.flatMap { result =>
        IO(assert(result.left.toOption.exists(_.isInstanceOf[JdbcFailure]))) *> db.transaction(c => integer(c, "SELECT 1")).void
      }
    } })
  }
  test("caller-owned source and projection writes share one atomic connection") {
    run(database.use { db => for {
      _ <- db.transaction(c => { execute(c, "DROP TABLE IF EXISTS runtime_source"); execute(c, "DROP TABLE IF EXISTS runtime_projection"); execute(c, "CREATE TABLE runtime_source(id int)"); execute(c, "CREATE TABLE runtime_projection(id int UNIQUE)") })
      _ <- db.transaction(c => { execute(c, "INSERT INTO runtime_source VALUES(1)"); execute(c, "INSERT INTO runtime_projection VALUES(1)") })
      rejected <- db.transaction(c => { execute(c, "INSERT INTO runtime_source VALUES(2)"); execute(c, "INSERT INTO runtime_projection VALUES(1)") }).attempt
      count <- db.transaction(c => integer(c, "SELECT count(*) FROM runtime_source"))
      _ <- IO { assert(rejected.isLeft); assertEquals(count, 1) }
    } yield () })
  }
}
