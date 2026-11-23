package ponygirls.runtime

import java.sql.{Connection, SQLException}
import java.util.concurrent.{CompletableFuture, Executor, TimeUnit, TimeoutException}
import scala.concurrent.duration.*
import scala.util.Using
import scala.util.control.NonFatal

/** A start waits, bounded, until PostgreSQL accepts queries: a new connection through the production login, then
  * `SELECT 1` returns a row. One monotonic deadline bounds every sleep, credential read, login and probe; a state that
  * passes by itself ([[JdbcTransient.connection]]) is waited out, any other failure ends the wait at once. Report lines
  * carry codes only. */
object DatabaseWait {
  val defaultBound: FiniteDuration = 120.seconds
  /** The accepted `startWaitMs` range; its lower end leaves the first attempt its [[minimumAttempt]]. */
  val minimumBound: FiniteDuration = 1.second
  val maximumBound: FiniteDuration = 1.hour
  val interval: FiniteDuration = 1.second
  /** A login starts only with this much time left (the shortest login timeout written); less is slept away. */
  val minimumAttempt: FiniteDuration = 100.millis
  /** The probe runs only with this much time left. */
  private val minimumProbe = 1.milli
  private val Probe = "SELECT 1"
  private val TimeoutCode = "database-wait-timeout"
  private val UnavailableCode = "database-unavailable"
  private val direct: Executor = _.run()
  private[runtime] val systemNanos: () => Long = () => System.nanoTime()
  private[runtime] val threadSleep: FiniteDuration => Unit = pause => TimeUnit.NANOSECONDS.sleep(pause.toNanos)

  private enum Attempt {
    case Ready
    case Waited(sqlState: String)
    /** The deadline came first: no time left to log in or to probe, or the caller stopped waiting. */
    case Expired
  }

  /** The connection of one attempt. Once its caller stops waiting (deadline or interrupt) it is aborted, which closes its
    * socket whatever the driver is blocked in, and a connection that arrives later is refused. */
  private final class Watch {
    private var connection: Option[Connection] = None
    private var ended = false
    def attach(opened: Connection): Boolean = synchronized {
      if (!ended) connection = Some(opened)
      !ended
    }
    def end(): Unit = synchronized {
      ended = true
      connection.foreach(c => try c.abort(direct) catch { case NonFatal(_) => () })
    }
  }

  /** A configured `startWaitMs` in the accepted range. */
  def startWait(milliseconds: Long): Option[FiniteDuration] =
    Option.when(milliseconds >= minimumBound.toMillis && milliseconds <= maximumBound.toMillis)(milliseconds.millis)

  /** Returns once the database accepts queries; at the bound throws `JdbcFailure("database-wait-timeout", last waited
    * SQLSTATE)`, on any other database refusal `JdbcFailure("database-unavailable", SQLSTATE)` at once. `report` gets
    * `database-wait code=jdbc-<SQLSTATE>` for the first waited failure and `database-wait ready seconds=<n>` after a wait.
    * An interrupt (cancellation) aborts the attempt in flight and ends the wait with `InterruptedException`. */
  def await(config: JdbcConfig, bound: FiniteDuration, report: String => Unit): Unit =
    await(config, bound, report, JdbcConnectionFactory.driverManager, systemNanos, threadSleep)

  private[runtime] def await(config: JdbcConfig, bound: FiniteDuration, report: String => Unit, factory: JdbcConnectionFactory,
      monotonicNanos: () => Long, sleep: FiniteDuration => Unit): Unit = {
    config.validate()
    require(bound >= minimumBound && bound <= maximumBound, "invalid database wait bound")
    Class.forName("org.postgresql.Driver")
    val start = monotonicNanos()
    val deadline = start + bound.toNanos
    def remaining: FiniteDuration = (deadline - monotonicNanos()).nanos
    /** Runs on the attempt's own thread: the credential read, the login and the probe, each only with time left. */
    def probe(watch: Watch): Either[Throwable, Attempt] = try {
      val password = CredentialFile.read(config.passwordFile)
      val left = remaining
      if (left < minimumAttempt) Right(Attempt.Expired)
      else {
        val limits = config.limits
        val login = (limits.connectTimeout min left) max minimumAttempt
        Using.resource(JdbcTransactionEngine.login(config, factory, password, java.math.BigDecimal.valueOf(login.toMillis, 3).toPlainString,
            limits.connectTimeout min left, limits.socketTimeout min left)) { connection =>
          if (!watch.attach(connection) || remaining < minimumProbe) Right(Attempt.Expired)
          else {
            val row = Using.resource(connection.createStatement())(statement => Using.resource(statement.executeQuery(Probe))(_.next()))
            if (row) Right(Attempt.Ready) else Left(JdbcFailure(UnavailableCode, None))
          }
        }
      }
    } catch {
      case error: SQLException =>
        Option(error.getSQLState).filter(_.matches("[A-Z0-9]{5}")) match {
          case Some(state) if JdbcTransient.connection(state) => Right(Attempt.Waited(state))
          case state => Left(JdbcFailure(UnavailableCode, state))
        }
      case NonFatal(error) => Left(error)
    }
    /** Waits for one attempt until the deadline; a result that arrives after it does not count. */
    def attempt(): Attempt = {
      val watch = new Watch
      val outcome = new CompletableFuture[Either[Throwable, Attempt]]()
      Thread.ofPlatform().daemon().name("database-wait").start(() => { outcome.complete(probe(watch)); () })
      val result = try outcome.get(math.max(0L, deadline - monotonicNanos()), TimeUnit.NANOSECONDS) catch {
        case _: TimeoutException => watch.end(); Right(Attempt.Expired)
        case interrupted: InterruptedException => watch.end(); throw interrupted
      }
      result match {
        case Right(Attempt.Ready) if monotonicNanos() > deadline => Attempt.Expired
        case Right(attempt) => attempt
        case Left(error) => throw error
      }
    }
    @annotation.tailrec def loop(last: Option[String]): Unit = {
      val left = remaining
      if (left < minimumAttempt) {
        if (left > Duration.Zero) sleep(left)
        throw JdbcFailure(TimeoutCode, last)
      }
      attempt() match {
        case Attempt.Ready => if (last.nonEmpty) report(s"database-wait ready seconds=${(monotonicNanos() - start).nanos.toSeconds}")
        case Attempt.Expired => loop(last)
        case Attempt.Waited(state) =>
          if (last.isEmpty) report(s"database-wait code=jdbc-$state")
          val pause = remaining min interval
          if (pause > Duration.Zero) sleep(pause)
          loop(Some(state))
      }
    }
    loop(None)
  }
}
