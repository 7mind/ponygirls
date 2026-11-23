package ponygirls.runtime

import java.sql.{Connection, DriverManager, SQLException}
import java.util.Properties
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

/** Shared synchronous physical transaction engine. Both facades own their admission. */
private[runtime] final class JdbcTransactionEngine(config: JdbcConfig, factory: JdbcConnectionFactory) {
  config.validate()
  Class.forName("org.postgresql.Driver")
  import JdbcTransactionEngine.Bounds
  def transaction[A](f: Connection => A): A = run(Bounds.Configured)(f)
  /** The configured bounds, except a transaction-local statement timeout of `timeout` (also above a stricter role
    * setting) with a network timeout of `timeout` plus the socket timeout. */
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = {
    require(timeout >= 1.millis && timeout <= 1.hour, "invalid JDBC timeout")
    run(Bounds.Extended(timeout))(f)
  }
  /** Every wait within `bound`: the login (login, connect and socket timeouts at most `bound`), each statement's lock wait
    * and execution (transaction-local statement and lock timeouts, tightened to `bound`) and each network read. */
  def boundedTransaction[A](bound: FiniteDuration)(f: Connection => A): A = {
    require(bound.toMillis >= 1 && bound <= 1.hour, "invalid JDBC bound")
    run(Bounds.Bounded(bound))(f)
  }
  private def run[A](bounds: Bounds)(f: Connection => A): A = {
      try {
        val c = connect(bounds)
        // Using may suppress close errors onto the primary error: wrap close first so
        // even that secondary failure cannot retain raw server diagnostics.
        val owner = new AutoCloseable {
          def close(): Unit = try c.close() catch {
            case scala.util.control.NonFatal(error) => throw secondary("database-close-failed", error)
          }
        }
        Using.resource(owner) { _ =>
          configure(c)
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
    val sql = """SELECT set_config(s.name,least(coalesce(nullif(s.setting::bigint,0),v.bound),v.bound)::text,false)
      FROM pg_settings s JOIN (VALUES ('statement_timeout',?::bigint),('lock_timeout',?::bigint),
      ('idle_in_transaction_session_timeout',?::bigint)) v(name,bound) ON s.name=v.name"""
    Using.resource(c.prepareStatement(sql)) { p =>
      p.setLong(1,config.limits.statementTimeout.toMillis)
      p.setLong(2,config.limits.lockTimeout.toMillis)
      p.setLong(3,config.limits.idleTransactionTimeout.toMillis)
      Using.resource(p.executeQuery()) { r => while (r.next()) () }
    }
  }

  /** Inside the transaction: its own statement (and lock) timeout and the network timeout after it. */
  private def limit(c: Connection, bounds: Bounds): Unit = bounds match {
    case Bounds.Configured => ()
    case Bounds.Extended(timeout) =>
      Using.resource(c.prepareStatement("SELECT set_config('statement_timeout',?::text,true)")) { p =>
        p.setLong(1, timeout.toMillis)
        Using.resource(p.executeQuery()) { r => while (r.next()) () }
      }
      c.setNetworkTimeout(JdbcTransactionEngine.direct, (timeout + config.limits.socketTimeout).toMillis.toInt)
    case Bounds.Bounded(bound) =>
      Using.resource(c.prepareStatement("SELECT set_config(name,least(coalesce(nullif(setting::bigint,0),?),?)::text,true) FROM pg_settings WHERE name IN('statement_timeout','lock_timeout')")) { p =>
        p.setLong(1, bound.toMillis); p.setLong(2, bound.toMillis)
        Using.resource(p.executeQuery()) { r => while (r.next()) () }
      }
      c.setNetworkTimeout(JdbcTransactionEngine.direct, bound.toMillis.toInt)
  }

  private def connect(bounds: Bounds): Connection = {
    val limits = config.limits
    bounds match {
      case Bounds.Bounded(bound) =>
        val login = limits.connectTimeout.min(bound)
        JdbcTransactionEngine.connect(config, factory, java.math.BigDecimal.valueOf(login.toMillis, 3).toPlainString, login, limits.socketTimeout.min(bound))
      case _ => JdbcTransactionEngine.connect(config, factory, JdbcTransactionEngine.seconds(limits.connectTimeout), limits.connectTimeout, limits.socketTimeout)
    }
  }
}
private[runtime] object JdbcTransactionEngine {
  /** Whole seconds rounded up, never below 1: the driver reads 0 as no limit. */
  def seconds(d: FiniteDuration): String = math.max(1L, (d.toMillis + 999L) / 1000L).toString
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
