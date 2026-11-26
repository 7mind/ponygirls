package ponygirls.runtime

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.sql.Connection
import munit.FunSuite
import scala.util.Using

// Behavioral/Active/Good-Communication: the statements that tighten a session's timeouts, against real PostgreSQL.
final class ServerTimeoutSuite extends FunSuite {
  import PostgresFixture.*
  private def configured[A](f: JdbcConfig => A): A = config.use(c => IO.blocking(f(c))).unsafeRunSync()
  /** The first column of every row of `sql` with `parameters`. */
  private def column(c: Connection, sql: String, parameters: Long*): List[String] = Using.resource(c.prepareStatement(sql)) { p =>
    parameters.zipWithIndex.foreach((value, i) => p.setLong(i + 1, value))
    Using.resource(p.executeQuery())(r => Iterator.continually(r).takeWhile(_.next()).map(_.getString(1)).toList)
  }
  /** The session's value in milliseconds, from `pg_settings` in a statement of its own. */
  private def millis(c: Connection, timeout: ServerTimeout): Long = column(c, s"SELECT setting FROM pg_settings WHERE name = '${timeout.setting}'").head.toLong

  test("a tightened timeout is the smaller of its bound and its current value, a disabled one the bound — what the expression over pg_settings gave — for the transaction only or for the session, for current values in every unit PostgreSQL prints and bounds below, at and above them, beyond a day") { configured { config =>
    // The lock timeout: nothing here waits for a lock, so no value of it ends a statement of the test.
    val lock = ServerTimeout.Lock
    val values = List(0L, 1, 999, 1000, 1500, 30000, 35000, 59999, 60000, 90000, 120000, 3600000, 5400000, 7200000, 86400000, 172800000, Int.MaxValue)
    val bounds = List(1L, 1000, 1500, 30000, 60000, 3600000, 7200001, 172800000, Int.MaxValue)
    Using.resource(plain(config)) { c =>
      for (current <- values; bound <- bounds) {
        execute(c, s"SET lock_timeout = $current")
        val reference = column(c, "SELECT least(coalesce(nullif(setting::bigint,0),?),?) FROM pg_settings WHERE name = 'lock_timeout'", bound, bound).map(_.toLong)
        c.setAutoCommit(false)
        val rows = column(c, ServerTimeout.tightenTransaction(lock), bound).size
        val inTransaction = millis(c, lock)
        c.commit(); c.setAutoCommit(true)
        val afterTransaction = millis(c, lock)
        column(c, ServerTimeout.tightenSession(lock), bound)
        val expected = if (current == 0) bound else current.min(bound)
        assertEquals((rows, inTransaction, afterTransaction, millis(c, lock), reference), (1, expected, current, expected, List(expected)), s"lock_timeout $current, bound $bound")
      }
    }
  } }

  test("each timeout of a statement takes its own bound, in the statement's order") { configured { config =>
    import ServerTimeout.*
    Using.resource(plain(config)) { c =>
      execute(c, "SET statement_timeout = '2min'; SET lock_timeout = '1500ms'; SET idle_in_transaction_session_timeout = '2d'")
      assertEquals(column(c, tightenSession(IdleInTransaction, Statement, Lock), 3600000, 90000, 35000), List("1h", "90s", "1500ms"))
      assertEquals(ServerTimeout.values.toList.map(millis(c, _)), List(90000L, 1500L, 3600000L))
      c.setAutoCommit(false)
      assertEquals(column(c, tightenTransaction(Lock, Statement), 1000, 60000), List("1s", "1min"))
      assertEquals(ServerTimeout.values.toList.map(millis(c, _)), List(60000L, 1000L, 3600000L))
      c.rollback()
      assertEquals(ServerTimeout.values.toList.map(millis(c, _)), List(90000L, 1500L, 3600000L))
    }
  } }

  test("a tighten statement scans nothing but its own VALUES list, one timeout's nothing at all: not pg_settings, whose function pg_show_all_settings materialises every setting") { configured { config =>
    Using.resource(plain(config)) { c =>
      assertEquals(scans(c, ServerTimeout.tightenTransaction(ServerTimeout.Statement), Map(1 -> 5000L)), Nil)
      assertEquals(scans(c, ServerTimeout.tightenSession(ServerTimeout.values*), Map(1 -> 30000L, 2 -> 35000L, 3 -> 60000L)), List("Values Scan"))
    }
  } }
}
