package ponygirls.runtime

import java.sql.SQLException
import java.util.concurrent.{Executor, TimeUnit}
import scala.concurrent.duration.*
import scala.util.Using

/** A start waits, bounded, until PostgreSQL accepts queries: a new connection through the production login, then
  * `SELECT 1` returns a row. One monotonic deadline bounds every sleep, login and probe; a state that passes by itself
  * ([[JdbcTransient.connection]]) is waited out, any other failure ends the wait at once. Report lines carry codes only. */
object DatabaseWait {
  val defaultBound: FiniteDuration = 120.seconds
  /** The accepted `startWaitMs` range; its lower end leaves the first attempt its [[minimumAttempt]]. */
  val minimumBound: FiniteDuration = 1.second
  val maximumBound: FiniteDuration = 1.hour
  val interval: FiniteDuration = 1.second
  /** An attempt starts only with this much time left (the shortest login timeout written); less is slept away. */
  val minimumAttempt: FiniteDuration = 100.millis
  /** The probe runs only with this much time left: a network timeout of 0 is no limit. */
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
    /** Logged in with less than [[minimumProbe]] left: no probe. */
    case Expired
  }

  /** A configured `startWaitMs` in the accepted range. */
  def startWait(milliseconds: Long): Option[FiniteDuration] =
    Option.when(milliseconds >= minimumBound.toMillis && milliseconds <= maximumBound.toMillis)(milliseconds.millis)

  /** Returns once the database accepts queries; at the bound throws `JdbcFailure("database-wait-timeout", last waited
    * SQLSTATE)`, on any other database refusal `JdbcFailure("database-unavailable", SQLSTATE)` at once. `report` gets
    * `database-wait code=jdbc-<SQLSTATE>` for the first waited failure and `database-wait ready seconds=<n>` after a wait. */
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
    def attempt(left: FiniteDuration): Attempt = {
      val limits = config.limits
      val login = (limits.connectTimeout min left) max minimumAttempt
      try Using.resource(JdbcTransactionEngine.connect(config, factory, java.math.BigDecimal.valueOf(login.toMillis, 3).toPlainString,
          limits.connectTimeout min left, limits.socketTimeout min left)) { connection =>
        val probe = remaining
        if (probe < minimumProbe) Attempt.Expired
        else {
          connection.setNetworkTimeout(direct, probe.toMillis.toInt)
          val row = Using.resource(connection.createStatement())(statement => Using.resource(statement.executeQuery(Probe))(_.next()))
          if (row) Attempt.Ready else throw JdbcFailure(UnavailableCode, None)
        }
      } catch {
        case error: SQLException =>
          Option(error.getSQLState).filter(_.matches("[A-Z0-9]{5}")) match {
            case Some(state) if JdbcTransient.connection(state) => Attempt.Waited(state)
            case state => throw JdbcFailure(UnavailableCode, state)
          }
      }
    }
    @annotation.tailrec def loop(last: Option[String]): Unit = {
      val left = remaining
      if (left < minimumAttempt) {
        if (left > Duration.Zero) sleep(left)
        throw JdbcFailure(TimeoutCode, last)
      }
      attempt(left) match {
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
