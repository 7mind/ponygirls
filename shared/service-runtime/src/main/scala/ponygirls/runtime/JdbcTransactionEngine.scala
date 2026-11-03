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

  private def connect(): Connection = {
    def seconds(d: FiniteDuration): String = math.max(1L, (d.toMillis + 999L) / 1000L).toString
    val limits = config.limits
    val props = new Properties
    props.setProperty("user", config.user)
    props.setProperty("password", CredentialFile.read(config.passwordFile))
    props.setProperty("connectTimeout", seconds(limits.connectTimeout))
    props.setProperty("loginTimeout", seconds(limits.connectTimeout))
    props.setProperty("socketTimeout", seconds(limits.socketTimeout))
    props.setProperty("tcpKeepAlive", "true")
    props.setProperty("options", s"-c statement_timeout=${limits.statementTimeout.toMillis} -c lock_timeout=${limits.lockTimeout.toMillis} -c idle_in_transaction_session_timeout=${limits.idleTransactionTimeout.toMillis}")
    factory.open(config.jdbcUrl, props)
  }
}
