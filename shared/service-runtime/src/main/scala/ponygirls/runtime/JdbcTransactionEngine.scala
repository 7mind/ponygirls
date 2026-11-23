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
  def transaction[A](f: Connection => A): A = {
      try {
        val c = connect()
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

  private def connect(): Connection = {
    val limits = config.limits
    JdbcTransactionEngine.connect(config, factory, JdbcTransactionEngine.seconds(limits.connectTimeout), limits.connectTimeout, limits.socketTimeout)
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
}
