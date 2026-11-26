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
    watchdog: JdbcTransactionEngine.Watchdog, nanoTime: () => Long, trace: JdbcTransactionEngine.Trace) extends AutoCloseable {
  def this(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing) = this(config, factory, sizing, JdbcTransactionEngine.scheduledWatchdog, JdbcTransactionEngine.systemNanoTime, JdbcTransactionEngine.Trace.none)
  def this(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing, trace: JdbcTransactionEngine.Trace) = this(config, factory, sizing, JdbcTransactionEngine.scheduledWatchdog, JdbcTransactionEngine.systemNanoTime, trace)
  config.validate()
  require(sizing.connections >= 1 && sizing.connections <= config.limits.maxConnections, "invalid pool sizing")
  Class.forName("org.postgresql.Driver")
  import JdbcTransactionEngine.*
  private val budget = acquisitionBudget(config.limits.connectTimeout)
  private val timing = Acquisition(budget)
  private val pool = newPool(poolConfig(new LoginSource(config, factory), sizing, timing))
  def transaction[A](f: Connection => A): A = run(Bounds.Configured)(f)
  /** The configured bounds, except a transaction-local statement timeout of `timeout` (also above a stricter role
    * setting) with a network timeout of `timeout` plus the socket timeout. */
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = {
    require(timeout >= 1.millis && timeout <= 1.hour, "invalid JDBC timeout")
    run(Bounds.Extended(timeout))(f)
  }
  /** The whole transaction by `deadline` D (R-a2 M1), converted once to the engine's clock: the acquisition ends by
    * min(D, its start + the budget), each reset by min(that, its start + the reset cap); from the handoff the transaction
    * watch aborts the connection at D; D is checked before the setup, the callback, each call of the callback that may
    * reach the server ([[GuardedConnection]]) and COMMIT (a refusal aborts through the watch); the setup tightens the statement
    * and lock timeouts to the time left; after D or the abort nothing more is sent (no ROLLBACK): the connection is evicted.
    * Fails `deadline-expired` for a refusal at a boundary and for a connection error caught after the watch aborted (an
    * unknown outcome once COMMIT was sent); every other error keeps its own SQLSTATE, also when it arrives after D. */
  def transactionWithin[A](deadline: Deadline)(f: Connection => A): A = {
    val end = nanoTime() + deadline.timeLeft.toNanos
    val c = try acquire(Bounds.Within(end)) catch { case e: SQLException => throw sanitize(e) }
    val watch = new Watch(c)
    var settled = false
    var primary: Option[Throwable] = None
    try {
      val left = end - nanoTime()
      val cancel = if (left > 0) watchdog.arm(left.nanos, () => watch.abort()) else () => ()
      try {
        boundary(watch, end)
        c.setAutoCommit(false)
        limit(c, Bounds.Within(end))
        boundary(watch, end)
        val result = f(new GuardedConnection(c, () => boundary(watch, end)))
        boundary(watch, end)
        c.commit()
        settled = nanoTime() - end <= 0
        result
      } catch {
        case scala.util.control.NonFatal(raw) =>
          val failure = outcome(raw, watch)
          primary = Some(failure)
          if (watch.armed && nanoTime() - end < 0) {
            try { c.rollback(); settled = nanoTime() - end <= 0 } catch {
              case scala.util.control.NonFatal(error) => failure.addSuppressed(secondary("database-rollback-failed", error))
            }
          }
          throw failure
      } finally cancel()
    } finally {
      if (watch.disarm() && settled) {
        try c.close() catch {
          case scala.util.control.NonFatal(error) =>
            val closing = secondary("database-close-failed", error)
            primary.fold(throw closing)(_.addSuppressed(closing))
        }
      } else pool.evictConnection(c)
    }
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

  /** One deadline `now + budget` (a [[transactionWithin]]'s D if earlier) bounds the borrows, the resets and their retries
    * (at most one more than the pool's connections). The pool does not validate on borrow (see [[newPool]]): a borrow waits
    * at most until the deadline, and a remainder below the pool's millisecond borrows once without waiting (an idle
    * connection or none; no borrow follows it), so every positive budget reaches the pool; the reset is the liveness check.
    * A connection whose reset fails, is aborted, throws or outlasts its cap is evicted, never handed out. */
  private def acquire(bounds: Bounds): Connection = {
    val budgeted = nanoTime() + budget.toNanos
    val deadline = bounds match {
      case Bounds.Within(end) if end - budgeted < 0 => end
      case _ => budgeted
    }
    @annotation.tailrec def attempt(tries: Int, last: Option[String]): Connection = {
      val remaining = deadline - nanoTime()
      if (tries > sizing.connections || remaining <= 0 || Thread.currentThread().isInterrupted) throw JdbcFailure(UnavailableCode, last)
      trace.borrow(remaining.nanos)
      val wait = TimeUnit.NANOSECONDS.toMillis(remaining)
      val borrowed = try Right(pool.getConnection(wait))
        catch { case e: SQLException => Left(sqlState(e)) }
      // A borrow without waiting (a remainder below the pool's millisecond) is the last one.
      borrowed match {
        case Left(state) if wait > 0 => attempt(tries + 1, state.orElse(last))
        case Left(state) => throw JdbcFailure(UnavailableCode, state.orElse(last))
        case Right(c) => handOver(c, deadline, timing, bounds) match {
          case Reset.Ready => c
          case Reset.Failed(state) if wait > 0 => attempt(tries + 1, state.orElse(last))
          case Reset.Failed(state) => throw JdbcFailure(UnavailableCode, state.orElse(last))
          case Reset.Late => throw JdbcFailure(UnavailableCode, last)
        }
      }
    }
    attempt(0, None)
  }

  /** Owns a borrowed connection until the caller gets it: on every other exit (a failed, aborted or over-cap reset, or any
    * throwable, an interruption included) it goes back evicted, to the pool only when the deadline passed (`Late`). */
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

  /** `DISCARD ALL` and the configured bounds in one execution, capped at `until` = min(deadline, now + reset cap): the
    * watchdog, armed for the time left until then, ends it whatever it waits for and owns the connection until the reset
    * disarms it; a reset that ends after `until` (an alarm delivered late, a reply arriving in pieces) is not accepted
    * either. Then the transaction's own network timeout, before any of its statements, and the acquisition deadline once
    * more. */
  private def reset(c: Connection, deadline: Long, timing: Acquisition, bounds: Bounds): Reset = {
    val started = nanoTime()
    val until = math.min(deadline, started + timing.resetCap.toNanos)
    val left = until - nanoTime()
    if (left <= 0) Reset.Late
    else {
      val watch = new Watch(c)
      try {
        val cancel = watchdog.arm(left.nanos, () => watch.abort())
        try {
          c.setNetworkTimeout(direct, millisUntil(until, nanoTime()))
          configure(c)
          if (!watch.disarm()) Reset.Failed(None)
          else {
            val ended = nanoTime()
            if (ended - deadline > 0) Reset.Late
            else if (ended - until > 0) Reset.Failed(None)
            else {
              c.setNetworkTimeout(direct, networkTimeout(bounds))
              // The deadline is checked last: a setter or a pause crossing it hands nothing over.
              if (nanoTime() - deadline > 0) Reset.Late else Reset.Ready
            }
          }
        } finally cancel()
      } catch { case e: SQLException => Reset.Failed(sqlState(e)) }
    }
  }

  /** The network timeout of a transaction's every read: the socket timeout (whole seconds, as the login's), the extended
    * statement timeout plus it, or the time left to the deadline. */
  private def networkTimeout(bounds: Bounds): Int = bounds match {
    case Bounds.Configured => (wholeSeconds(config.limits.socketTimeout) * 1000L).toInt
    case Bounds.Extended(timeout) => (timeout + config.limits.socketTimeout).toMillis.toInt
    case Bounds.Within(end) => millisUntil(end, nanoTime())
  }
  /** A boundary of [[transactionWithin]]: past the deadline, or after the watch aborted, the try is refused through the
    * watch. */
  private def boundary(watch: Watch, end: Long): Unit =
    if (!watch.armed || nanoTime() - end >= 0) { watch.abort(); throw JdbcFailure(DeadlineCode, None) }
  /** The deadline outcome: a connection error (class 08 or no SQLSTATE) caught after the watch aborted is the abort's. */
  private def outcome(error: Throwable, watch: Watch): Throwable = error match {
    case e: SQLException if watch.aborted && sqlState(e).forall(_.startsWith(ConnectionClass)) => JdbcFailure(DeadlineCode, sqlState(e))
    case other => sanitize(other)
  }

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
    // Read each timeout's current value in the session and only tighten it. One trusted,
    // bound constant-size setup query, fully exhausted before the caller transaction.
    // The bounds in the order of ResetSql's timeouts.
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
    case Bounds.Within(end) =>
      Using.resource(c.prepareStatement(WithinSql)) { p =>
        val left = millisUntil(end, nanoTime()).toLong
        p.setLong(1, left); p.setLong(2, left)
        Using.resource(p.executeQuery()) { r => while (r.next()) () }
      }
  }
}
private[runtime] object JdbcTransactionEngine {
  /** A connection the pool could not supply by the acquisition deadline (with the last SQLSTATE seen, if any). */
  private[runtime] val UnavailableCode = "connection-unavailable"
  /** A [[JdbcTransactionEngine.transactionWithin]] refused at a boundary past its deadline, or cut by its watch (with the
    * driver's SQLSTATE, if any). */
  private[runtime] val DeadlineCode = "deadline-expired"
  private val ConnectionClass = "08"
  private val PoolName = "jdbc"
  /** A pooled connection lives 22.5 to 30 minutes (the pool's variance), then a new login replaces it. */
  val maximumLifetime: FiniteDuration = 30.minutes
  /** An idle pooled connection is checked this often (server `idle_session_timeout` must be 0 or at least 3 minutes). */
  val keepaliveTime: FiniteDuration = 2.minutes
  /** A connection of a pool that is not fixed closes after this long idle. */
  val idleTimeout: FiniteDuration = 10.minutes
  /** The validation and reset waits are never shorter (the pool's own floor). */
  private val WaitFloor = 250.millis
  /** Hikari validates a connection idle for 500 ms before handing it out, up to its validation timeout, outside any
    * caller's deadline; with this window it never does (it reads the window once, when a pool is built). Idle connections
    * are still validated in the background by the keepalive. The property is JVM-global: it is set only while a pool is
    * built under [[PoolConstruction]] and restored afterwards, which is sound for every pool built here; a pool built
    * elsewhere in the process while it is set (none is) would lose its own borrow validation. */
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
    * bounds, tighten-only ([[ServerTimeout.tightenSession]]). One execution with bound parameters; pgjdbc re-prepares its
    * statements after `DISCARD ALL`. */
  private val ResetSql = "DISCARD ALL; " + ServerTimeout.tightenSession(ServerTimeout.Statement, ServerTimeout.Lock, ServerTimeout.IdleInTransaction)
  /** The setup of a transaction within a deadline: its statement and lock timeouts, tightened to the time left. */
  private val WithinSql = ServerTimeout.tightenTransaction(ServerTimeout.Statement, ServerTimeout.Lock)
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
  private val systemNanoTime: () => Long = () => System.nanoTime()
  /** Test seam (R-a2 M1): told when a try of [[JdbcTransactionEngine.transactionWithin]] enters its admission (with the
    * time left to its deadline) and when each borrow starts (with the time it may wait; the pool waits its whole
    * milliseconds). */
  private[runtime] trait Trace {
    def admission(left: FiniteDuration): Unit
    def borrow(remaining: FiniteDuration): Unit
  }
  private[runtime] object Trace {
    val none: Trace = new Trace {
      def admission(left: FiniteDuration): Unit = ()
      def borrow(remaining: FiniteDuration): Unit = ()
    }
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
  /** Armed until either its owner (the reset, or the transaction's exit) disarms it or the watchdog aborts the connection;
    * exactly one of the two happens. */
  private final class Watch(c: Connection) {
    private val state = new AtomicInteger(Watch.Armed)
    def armed: Boolean = state.get == Watch.Armed
    def aborted: Boolean = state.get == Watch.Aborted
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
    /** The acquisition deadline passed before the reset started or before it ended in time: the connection goes back to the
      * pool. */
    case Late
  }
  private def millisUntil(instant: Long, now: Long): Int =
    math.max(1L, TimeUnit.NANOSECONDS.toMillis(instant - now + 999999L)).min(Int.MaxValue.toLong).toInt
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
    /** Until `end` on the engine's clock. */
    case Within(end: Long)
  }
}
