package ponygirls.runtime

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.pool.HikariPool
import java.io.PrintWriter
import java.sql.{Connection, DriverManager, SQLException, SQLFeatureNotSupportedException}
import java.util.Properties
import java.util.concurrent.{ScheduledThreadPoolExecutor, ThreadFactory, TimeUnit}
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import scala.concurrent.duration.*
import scala.util.Using

/** Trusted explicit adapter seam (for driver probes/tests); never user-supplied SQL/config. */
trait JdbcConnectionFactory {
  def open(url: String, properties: Properties): Connection
}
object JdbcConnectionFactory {
  val driverManager: JdbcConnectionFactory = new JdbcConnectionFactory {
    def open(url: String, properties: Properties): Connection = DriverManager.getConnection(url, properties)
  }
}

/** Shared synchronous transaction engine over one bounded pool (restart-robustness spec §5). Both facades own their
  * admission; after it, a transaction borrows a pooled connection, resets it and runs on it. */
private[runtime] final class JdbcTransactionEngine(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing,
    watchdog: JdbcTransactionEngine.Watchdog) extends AutoCloseable {
  def this(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing) = this(config, factory, sizing, JdbcTransactionEngine.scheduledWatchdog)
  config.validate()
  require(sizing.connections >= 1 && sizing.connections <= config.limits.maxConnections, "invalid pool sizing")
  Class.forName("org.postgresql.Driver")
  import JdbcTransactionEngine.*
  private val budget = acquisitionBudget(config.limits.connectTimeout)
  private val pool = newPool(poolConfig(new LoginSource(config, factory), sizing, Acquisition(budget)))
  def transaction[A](f: Connection => A): A = run(Bounds.Configured)(f)
  /** The configured bounds, except a transaction-local statement timeout of `timeout` (also above a stricter role
    * setting) with a network timeout of `timeout` plus the socket timeout. */
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = {
    require(timeout >= 1.millis && timeout <= 1.hour, "invalid JDBC timeout")
    run(Bounds.Extended(timeout))(f)
  }
  /** Every wait within `bound`: the acquisition (its budget at most `bound`), each statement's lock wait and execution
    * (transaction-local statement and lock timeouts, tightened to `bound`) and each network read, the setup's included. */
  def boundedTransaction[A](bound: FiniteDuration)(f: Connection => A): A = {
    require(bound.toMillis >= 1 && bound <= 1.hour, "invalid JDBC bound")
    run(Bounds.Bounded(bound))(f)
  }
  /** Closes every pooled connection; the facades drain their admissions first. The shutdown completes whatever interrupts
    * the caller: an interrupt is remembered and restored once the pool is closed. */
  def close(): Unit = {
    var interrupted = Thread.interrupted()
    var closed = false
    while (!closed) {
      try { pool.shutdown(); closed = true }
      catch { case _: InterruptedException => interrupted = true }
    }
    if (interrupted) Thread.currentThread().interrupt()
  }
  private def run[A](bounds: Bounds)(f: Connection => A): A = {
      try {
        val c = acquire(bounds)
        // Using may suppress close errors onto the primary error: wrap close first so
        // even that secondary failure cannot retain raw server diagnostics.
        val owner = new AutoCloseable {
          def close(): Unit = try c.close() catch {
            case scala.util.control.NonFatal(error) => throw secondary("database-close-failed", error)
          }
        }
        Using.resource(owner) { _ =>
          c.setAutoCommit(false)
          try {
            limit(c, bounds)
            val result = f(c)
            c.commit()
            result
          } catch {
            case scala.util.control.NonFatal(raw) =>
              val primary = sanitize(raw)
              try c.rollback() catch {
                case scala.util.control.NonFatal(error) => primary.addSuppressed(secondary("database-rollback-failed", error))
              }
              throw primary
          }
        }
      } catch {
        case e: SQLException => throw sanitize(e)
      }
  }

  /** One deadline `now + budget` bounds the borrows, the resets and their retries (at most one more than the pool's
    * connections). The pool does not validate on borrow (see [[newPool]]): a borrow waits at most until the deadline, so
    * any budget of at least `minimumWait` is usable; the reset is the liveness check. A connection whose reset fails, is
    * aborted or throws is evicted, never handed out. */
  private def acquire(bounds: Bounds): Connection = {
    val budgeted = bounds match {
      case Bounds.Bounded(bound) => budget.min(bound)
      case _ => budget
    }
    val timing = Acquisition(budgeted)
    val deadline = System.nanoTime() + budgeted.toNanos
    @annotation.tailrec def attempt(tries: Int, last: Option[String]): Connection = {
      val remaining = deadline - System.nanoTime()
      if (tries > sizing.connections || remaining < minimumWait.toNanos || Thread.currentThread().isInterrupted) throw JdbcFailure(UnavailableCode, last)
      val borrowed = try Right(pool.getConnection(TimeUnit.NANOSECONDS.toMillis(remaining)))
        catch { case e: SQLException => Left(sqlState(e)) }
      borrowed match {
        case Left(state) => attempt(tries + 1, state.orElse(last))
        case Right(c) => handOver(c, deadline, timing, bounds) match {
          case Reset.Ready => c
          case Reset.Failed(state) => attempt(tries + 1, state.orElse(last))
          case Reset.Late => throw JdbcFailure(UnavailableCode, last)
        }
      }
    }
    attempt(0, None)
  }

  /** Owns a borrowed connection until the caller gets it: on every other exit (a failed, aborted or late reset, or any
    * throwable, an interruption included) it goes back, evicted, or to the pool only when its reset succeeded too late. */
  private def handOver(c: Connection, deadline: Long, timing: Acquisition, bounds: Bounds): Reset = {
    var outcome: Option[Reset] = None
    try {
      outcome = Some(reset(c, deadline, timing, bounds))
      outcome.get
    } finally outcome match {
      case Some(Reset.Ready) => ()
      case Some(Reset.Late) => c.close()
      case _ => pool.evictConnection(c)
    }
  }

  /** `DISCARD ALL` and the configured bounds in one execution, ended by the watchdog at min(deadline, now + reset cap)
    * whatever it waits for; the watchdog owns the connection until the reset disarms it. Then the transaction's own
    * network timeout, before any of its statements. */
  private def reset(c: Connection, deadline: Long, timing: Acquisition, bounds: Bounds): Reset = {
    val started = System.nanoTime()
    val until = math.min(deadline, started + timing.resetCap.toNanos)
    val watch = new Watch(c)
    try {
      val cancel = watchdog.arm((until - started).nanos, () => watch.abort())
      try {
        c.setNetworkTimeout(direct, millisUntil(until))
        configure(c)
        if (!watch.disarm()) Reset.Failed(None)
        else {
          c.setNetworkTimeout(direct, networkTimeout(bounds))
          if (System.nanoTime() - deadline > 0) Reset.Late else Reset.Ready
        }
      } finally cancel()
    } catch { case e: SQLException => Reset.Failed(sqlState(e)) }
  }

  /** The network timeout of a transaction's every read: the socket timeout (whole seconds, as the login's), the extended
    * statement timeout plus it, or the bound. */
  private def networkTimeout(bounds: Bounds): Int = (bounds match {
    case Bounds.Configured => (wholeSeconds(config.limits.socketTimeout) * 1000L).millis
    case Bounds.Extended(timeout) => timeout + config.limits.socketTimeout
    case Bounds.Bounded(bound) => bound
  }).toMillis.toInt

  private def sqlState(error: Throwable): Option[String] = error match {
    case e: SQLException => Option(e.getSQLState).filter(_.matches("[A-Z0-9]{5}"))
    case _ => None
  }
  private def secondary(code: String, error: Throwable): JdbcFailure = JdbcFailure(code, sqlState(error))
  private def sanitize(error: Throwable): Throwable = error match {
    case safe: JdbcFailure => safe
    case _: SQLException => secondary("database-unavailable", error)
    case other => other
  }

  private def configure(c: Connection): Unit = {
    // Startup `options=-c ...` would override a stricter role/database timeout.
    // Read the effective numeric pg_settings value and only tighten it. One trusted,
    // bound constant-size setup query, fully exhausted before the caller transaction.
    Using.resource(c.prepareStatement(ResetSql)) { p =>
      p.setLong(1,config.limits.statementTimeout.toMillis)
      p.setLong(2,config.limits.lockTimeout.toMillis)
      p.setLong(3,config.limits.idleTransactionTimeout.toMillis)
      var rows = p.execute()
      while (rows || p.getUpdateCount != -1) {
        if (rows) Using.resource(p.getResultSet) { r => while (r.next()) () }
        rows = p.getMoreResults()
      }
    }
  }

  /** Inside the transaction, under its network timeout (set by the reset): its own statement (and lock) timeout. */
  private def limit(c: Connection, bounds: Bounds): Unit = bounds match {
    case Bounds.Configured => ()
    case Bounds.Extended(timeout) =>
      Using.resource(c.prepareStatement("SELECT set_config('statement_timeout',?::text,true)")) { p =>
        p.setLong(1, timeout.toMillis)
        Using.resource(p.executeQuery()) { r => while (r.next()) () }
      }
    case Bounds.Bounded(bound) =>
      Using.resource(c.prepareStatement("SELECT set_config(name,least(coalesce(nullif(setting::bigint,0),?),?)::text,true) FROM pg_settings WHERE name IN('statement_timeout','lock_timeout')")) { p =>
        p.setLong(1, bound.toMillis); p.setLong(2, bound.toMillis)
        Using.resource(p.executeQuery()) { r => while (r.next()) () }
      }
  }
}
private[runtime] object JdbcTransactionEngine {
  private val UnavailableCode = "connection-unavailable"
  private val PoolName = "jdbc"
  /** A pooled connection lives 22.5 to 30 minutes (the pool's variance), then a new login replaces it. */
  val maximumLifetime: FiniteDuration = 30.minutes
  /** An idle pooled connection is checked this often (server `idle_session_timeout` must be 0 or at least 3 minutes). */
  val keepaliveTime: FiniteDuration = 2.minutes
  /** A connection of a pool that is not fixed closes after this long idle. */
  val idleTimeout: FiniteDuration = 10.minutes
  /** The validation and reset waits are never shorter (the pool's own floor). */
  private val WaitFloor = 250.millis
  /** A borrow starts only with this much of the acquisition budget left (the pool waits in whole milliseconds). */
  val minimumWait: FiniteDuration = 1.milli
  /** Hikari validates a connection idle for 500 ms before handing it out, up to its validation timeout, outside any
    * caller's deadline; with this window it never does (it reads the window once, when a pool is built). Idle connections
    * are still validated in the background by the keepalive. */
  private val AliveBypassWindow = "com.zaxxer.hikari.aliveBypassWindowMs"
  private object PoolConstruction
  private def newPool(config: HikariConfig): HikariPool = PoolConstruction.synchronized {
    val previous = Option(System.getProperty(AliveBypassWindow))
    System.setProperty(AliveBypassWindow, Long.MaxValue.toString)
    try new HikariPool(config)
    finally previous.fold(System.clearProperty(AliveBypassWindow))(System.setProperty(AliveBypassWindow, _))
  }
  private val ValidationCeiling = 1.second
  /** The per-borrow reset (restart-robustness spec §5): every session state back to the login's, then the configured
    * bounds, tighten-only. One execution with bound parameters; pgjdbc re-prepares its statements after `DISCARD ALL`. */
  private val ResetSql = """DISCARD ALL; SELECT set_config(s.name,least(coalesce(nullif(s.setting::bigint,0),v.bound),v.bound)::text,false)
      FROM pg_settings s JOIN (VALUES ('statement_timeout',?::bigint),('lock_timeout',?::bigint),
      ('idle_in_transaction_session_timeout',?::bigint)) v(name,bound) ON s.name=v.name"""
  /** Whole seconds rounded up, never below 1: the driver reads 0 as no limit. */
  def wholeSeconds(d: FiniteDuration): Long = math.max(1L, (d.toMillis + 999L) / 1000L)
  def seconds(d: FiniteDuration): String = wholeSeconds(d).toString
  /** The acquisition budget A: the connect timeout in whole seconds, as the driver's login timeout always was. */
  def acquisitionBudget(connectTimeout: FiniteDuration): FiniteDuration = wholeSeconds(connectTimeout).seconds
  /** The pool's background validation of an idle connection (V, keepalive) and the reset's cap, from the acquisition
    * budget. */
  final case class Acquisition(budget: FiniteDuration) {
    val validation: FiniteDuration = (budget / 4).min(ValidationCeiling).max(WaitFloor)
    val resetCap: FiniteDuration = (budget / 4).max(WaitFloor)
  }
  /** Runs `alarm` once after `delay` unless the returned cancel runs first. */
  trait Watchdog {
    def arm(delay: FiniteDuration, alarm: () => Unit): () => Unit
  }
  val scheduledWatchdog: Watchdog = new Watchdog {
    private lazy val scheduler = {
      val threads: ThreadFactory = work => Thread.ofPlatform().daemon().name("jdbc-reset-watchdog").unstarted(work)
      val executor = new ScheduledThreadPoolExecutor(1, threads)
      executor.setRemoveOnCancelPolicy(true)
      executor
    }
    def arm(delay: FiniteDuration, alarm: () => Unit): () => Unit = {
      val scheduled = scheduler.schedule((() => alarm()): Runnable, delay.toNanos, TimeUnit.NANOSECONDS)
      () => { scheduled.cancel(false); () }
    }
  }
  /** Armed until either the reset disarms it (the connection goes to the caller) or the watchdog aborts the connection;
    * exactly one of the two happens. */
  private final class Watch(c: Connection) {
    private val state = new AtomicInteger(Watch.Armed)
    def disarm(): Boolean = state.compareAndSet(Watch.Armed, Watch.Disarmed)
    def abort(): Unit = if (state.compareAndSet(Watch.Armed, Watch.Aborted)) {
      try c.abort(direct) catch { case scala.util.control.NonFatal(_) => () }
    }
  }
  private object Watch {
    val Armed = 0
    val Disarmed = 1
    val Aborted = 2
  }
  private enum Reset {
    case Ready
    case Failed(sqlState: Option[String])
    /** Reset in time, but the acquisition deadline passed: the connection goes back to the pool. */
    case Late
  }
  private def millisUntil(instant: Long): Int =
    math.max(1L, TimeUnit.NANOSECONDS.toMillis(instant - System.nanoTime() + 999999L)).min(Int.MaxValue.toLong).toInt
  /** The pool's physical connections: the production login, the password file read for each (a rotated file serves the
    * next login; existing connections stay authenticated until retired). */
  private final class LoginSource(config: JdbcConfig, factory: JdbcConnectionFactory) extends DataSource {
    def getConnection(): Connection = connect(config, factory, seconds(config.limits.connectTimeout), config.limits.connectTimeout, config.limits.socketTimeout)
    def getConnection(user: String, password: String): Connection = throw new SQLFeatureNotSupportedException()
    def getLogWriter: PrintWriter = null
    def setLogWriter(out: PrintWriter): Unit = ()
    /** The login carries its own timeouts. */
    def setLoginTimeout(seconds: Int): Unit = ()
    def getLoginTimeout: Int = wholeSeconds(config.limits.connectTimeout).toInt
    def getParentLogger: java.util.logging.Logger = throw new SQLFeatureNotSupportedException()
    def unwrap[T](iface: Class[T]): T = throw new SQLFeatureNotSupportedException()
    def isWrapperFor(iface: Class[?]): Boolean = false
  }
  private def poolConfig(source: DataSource, sizing: JdbcPoolSizing, timing: Acquisition): HikariConfig = {
    val c = new HikariConfig()
    c.setPoolName(PoolName)
    c.setDataSource(source)
    c.setMaximumPoolSize(sizing.connections)
    c.setMinimumIdle(if (sizing.fixed) sizing.connections else 0)
    c.setIdleTimeout(idleTimeout.toMillis)
    c.setMaxLifetime(maximumLifetime.toMillis)
    c.setKeepaliveTime(keepaliveTime.toMillis)
    c.setValidationTimeout(timing.validation.toMillis)
    // Unused by borrows, which pass their own timeout; the pool requires one.
    c.setConnectionTimeout(timing.budget.max(WaitFloor).toMillis)
    c.setLeakDetectionThreshold(0)
    // Never fail construction: logins are retried in the background, borrowers fail within their deadline.
    c.setInitializationFailTimeout(-1)
    c.validate()
    c
  }
  /** The production login with the password file read now (see [[login]]). */
  def connect(config: JdbcConfig, factory: JdbcConnectionFactory, loginTimeout: String, connectTimeout: FiniteDuration, socketTimeout: FiniteDuration): Connection =
    login(config, factory, CredentialFile.read(config.passwordFile), loginTimeout, connectTimeout, socketTimeout)
  /** The production login: configured user, the password its caller read from the password file, bounded driver timeouts,
    * keep-alive. `loginTimeout` is the driver's text value in seconds (fractions allowed); connect and socket timeouts
    * round up. */
  def login(config: JdbcConfig, factory: JdbcConnectionFactory, password: String, loginTimeout: String, connectTimeout: FiniteDuration,
      socketTimeout: FiniteDuration): Connection = {
    val props = new Properties
    props.setProperty("user", config.user)
    props.setProperty("password", password)
    props.setProperty("connectTimeout", seconds(connectTimeout))
    props.setProperty("loginTimeout", loginTimeout)
    props.setProperty("socketTimeout", seconds(socketTimeout))
    props.setProperty("tcpKeepAlive", "true")
    factory.open(config.jdbcUrl, props)
  }
  private val direct: java.util.concurrent.Executor = (work: Runnable) => work.run()
  private enum Bounds {
    case Configured
    case Extended(timeout: FiniteDuration)
    case Bounded(bound: FiniteDuration)
  }
}
