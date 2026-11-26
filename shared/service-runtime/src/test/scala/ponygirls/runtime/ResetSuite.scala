package ponygirls.runtime

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.nio.file.Files
import java.sql.{Connection, DriverManager}
import java.util.Properties
import munit.FunSuite
import scala.concurrent.duration.*
import scala.util.Using

// Behavioral/Active/Good-Communication: the bounds of the per-borrow reset against real PostgreSQL (restart-robustness
// spec §5, per-borrow reset): the statement, lock and idle-in-transaction timeouts a borrowed session is left with.
final class ResetSuite extends FunSuite {
  import PostgresFixture.*
  private def configured[A](f: JdbcConfig => A): A = config.use(c => IO.blocking(f(c))).unsafeRunSync()
  private val settings = List("statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout")
  /** A session of the test's own, outside every pool. */
  private def plain(config: JdbcConfig): Connection = {
    val p = new Properties; p.setProperty("user", config.user); p.setProperty("password", CredentialFile.read(config.passwordFile))
    DriverManager.getConnection(config.jdbcUrl, p)
  }
  private def row[A](c: Connection, sql: String)(read: java.sql.ResultSet => A): A =
    Using.resource(c.createStatement())(s => Using.resource(s.executeQuery(sql)) { r => r.next(); read(r) })
  /** The session's three timeouts in milliseconds, from `pg_settings` in a statement of its own (a statement that sets them
    * as well may read the values from before). */
  private def millis(c: Connection): List[Long] =
    row(c, settings.map(name => s"(SELECT setting::bigint FROM pg_settings WHERE name = '$name')").mkString("SELECT ", ", ", ""))(r => settings.indices.toList.map(i => r.getLong(i + 1)))
  private def printed(c: Connection): List[String] =
    row(c, settings.map(name => s"current_setting('$name')").mkString("SELECT ", ", ", ""))(r => settings.indices.toList.map(i => r.getString(i + 1)))
  /** Reference for what the reset must leave: the tighten-only bounds computed from `pg_settings.setting` (plain
    * milliseconds), one `bigint` parameter per timeout. */
  private val reference = """SELECT set_config(s.name,least(coalesce(nullif(s.setting::bigint,0),v.bound),v.bound)::text,false)
      FROM pg_settings s JOIN (VALUES ('statement_timeout',?::bigint),('lock_timeout',?::bigint),
      ('idle_in_transaction_session_timeout',?::bigint)) v(name,bound) ON s.name=v.name"""
  private def referenced(c: Connection, bounds: List[FiniteDuration]): List[Long] = {
    Using.resource(c.prepareStatement(reference)) { p =>
      bounds.zipWithIndex.foreach((bound, i) => p.setLong(i + 1, bound.toMillis))
      Using.resource(p.executeQuery()) { r => while (r.next()) () }
    }
    millis(c)
  }
  /** What a borrowed session is left with: the timeouts a transaction of a new runtime (one login, one reset) reads. */
  private def reset(config: JdbcConfig, bounds: List[FiniteDuration]): List[Long] = {
    val limits = config.limits.copy(maxConnections = 1, statementTimeout = bounds(0), lockTimeout = bounds(1), idleTransactionTimeout = bounds(2))
    Using.resource(new BlockingJdbcDatabase(config.copy(limits = limits)))(_.transaction(millis))
  }
  /** Waits (no fixed time) until `condition` holds; the bound only keeps a broken run from hanging. */
  private def eventually(what: => String)(condition: => Boolean): Unit = {
    val bound = System.nanoTime() + 10.seconds.toNanos
    while (!condition) { assert(System.nanoTime() < bound, what); Thread.onSpinWait() }
  }

  /** A login default in milliseconds and its text in `current_setting`: PostgreSQL prints the largest unit that divides the
    * value exactly. */
  private final case class Default(millis: Long, printed: String)
  private val defaults = List(Default(0, "0"), Default(1, "1ms"), Default(999, "999ms"), Default(1000, "1s"), Default(1500, "1500ms"), Default(30000, "30s"),
    Default(35000, "35s"), Default(59999, "59999ms"), Default(60000, "1min"), Default(90000, "90s"), Default(120000, "2min"), Default(3600000, "1h"),
    Default(5400000, "90min"), Default(7200000, "2h"), Default(86400000, "1d"), Default(172800000, "2d"), Default(Int.MaxValue, "2147483647ms"))
  /** One login's defaults (statement, lock, idle-in-transaction). The lock timeout takes every default: nothing here waits
    * for a lock. A statement or idle-in-transaction timeout of a second or two could end the statements that read the
    * outcome on a loaded host, so these two take the defaults from 30 s on (and the disabled one). */
  private val logins: List[List[Default]] = {
    val lasting = defaults.filter(d => d.millis == 0 || d.millis >= 30000)
    defaults.indices.toList.map(i => List(lasting((i + 4) % lasting.size), defaults(i), lasting((i + 8) % lasting.size)))
  }
  /** Chronicle's production bounds (statement 30 s, lock 35 s, idle-in-transaction 60 s), and the largest the runtime
    * accepts: with them a default printed in minutes is the stricter one, one of an hour the equal one. */
  private val boundSets = List(List(30.seconds, 35.seconds, 60.seconds), List(1.hour, 1.hour, 1.hour))
  private val role = "reset_probe"
  private val rolePassword = "reset-probe-password"

  test("the reset leaves each timeout at the smaller of its bound and the session's login default, a disabled one at the bound: what the pg_settings reference leaves, for defaults in every unit PostgreSQL prints, set for the role and for the role in the database, under every IntervalStyle") { configured { config =>
    val password = Files.createTempFile("reset-probe-", ".txt")
    try Using.resource(plain(config)) { admin =>
      execute(admin, s"DROP ROLE IF EXISTS $role; CREATE ROLE $role LOGIN PASSWORD '$rolePassword'")
      try {
        Files.writeString(password, rolePassword + "\n")
        val probe = config.copy(user = role, passwordFile = password)
        val database = row(admin, "SELECT quote_ident(current_database())")(_.getString(1))
        // Where a service role's default comes from at login: the role, or (the NixOS provider's form) the role in the database.
        val sources = List(s"ALTER ROLE $role", s"ALTER ROLE $role IN DATABASE $database")
        def check(bounds: List[FiniteDuration], source: String, login: List[Default], style: String): Unit = {
          execute(admin, (sources.map(_ + " RESET ALL") ++ List(s"ALTER ROLE $role SET IntervalStyle = '$style'") ++
            settings.zip(login).map((name, default) => s"$source SET $name = ${default.millis}")).mkString("; "))
          val clue = s"$source SET ${login.map(_.printed).mkString(", ")}; IntervalStyle $style; bounds ${bounds.mkString(", ")}"
          val referenceLeft = Using.resource(plain(probe)) { c =>
            assertEquals((printed(c), row(c, "SHOW IntervalStyle")(_.getString(1))), (login.map(_.printed), style), clue)
            referenced(c, bounds)
          }
          val left = reset(probe, bounds)
          assertEquals(left, referenceLeft, clue)
          assertEquals(left, login.zip(bounds).map((default, bound) => if (default.millis == 0) bound.toMillis else default.millis.min(bound.toMillis)), clue)
        }
        for (bounds <- boundSets; source <- sources; login <- logins) check(bounds, source, login, "postgres")
        // Whatever the session's IntervalStyle.
        for (style <- List("postgres_verbose", "sql_standard", "iso_8601"); source <- sources)
          check(boundSets.last, source, List(Default(120000, "2min"), Default(1500, "1500ms"), Default(172800000, "2d")), style)
      } finally execute(admin, s"DROP ROLE IF EXISTS $role")
    } finally Files.deleteIfExists(password)
  } }

  test("the reset tightens from the session's value at that borrow: defaults changed under a pooled session (a configuration reload) are what its next borrow is tightened from, and loosened again they leave the bounds") { configured { config =>
    val hour = List.fill(3)(1.hour)
    val loose = config.limits.copy(maxConnections = 1, statementTimeout = hour(0), lockTimeout = hour(1), idleTransactionTimeout = hour(2))
    // Below these bounds, far above every other suite's: a default that outlived this case would tighten nothing elsewhere.
    val reloaded = List(50.minutes, 45.minutes, 40.minutes)
    Using.resources(plain(config), new BlockingJdbcDatabase(config.copy(limits = loose))) { (admin, db) =>
      def system(change: String => String): Unit = { settings.foreach(name => execute(admin, change(name))); execute(admin, "SELECT pg_reload_conf()") }
      def borrowed(): (Int, List[Long]) = db.transaction(c => (integer(c, "SELECT pg_backend_pid()"), millis(c)))
      val (backend, before) = borrowed()
      assertEquals(before, hour.map(_.toMillis))
      var last = (backend, before)
      try {
        val changes = settings.zip(reloaded).toMap
        system(name => s"ALTER SYSTEM SET $name = ${changes(name).toMillis}")
        eventually(s"the reloaded defaults reach the pooled session: $last") { last = borrowed(); last == (backend, reloaded.map(_.toMillis)) }
      } finally system(name => s"ALTER SYSTEM RESET $name")
      eventually(s"the restored defaults reach the pooled session: $last") { last = borrowed(); last == (backend, before) }
    }
  } }
}
