package ponygirls.runtime

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.sql.{Connection, DriverManager, SQLException}
import java.util.Properties
import scala.concurrent.duration.*
import scala.util.Using

/** Safe driver failure. sqlState is a five-character class/code, never driver message/cause. */
final case class JdbcFailure(code: String, sqlState: Option[String]) extends RuntimeException(code)

/** One scoped connection per transaction; not a connection pool. No IO on compute threads.
  * Callbacks are trusted, synchronous, must terminate, close statements/results, and must not
  * escape/commit/rollback/close the connection or weaken configured PostgreSQL limits.
  * Cancellation of a running callback is deliberately deferred until rollback/commit and close.
  * Thus HTTP timeouts do NOT imply the write did not commit. Use domain idempotency keys.
  */
final class JdbcDatabase private (config: JdbcConfig, gate: Admission) {
  def transaction[A](f: Connection => A): IO[A] = gate.run(IO.uncancelable { _ =>
    IO.blocking {
      try Using.resource(connect()) { c =>
        c.setAutoCommit(false)
        try {
          val result = f(c)
          c.commit()
          result
        } catch {
          case scala.util.control.NonFatal(error) =>
            try c.rollback() catch { case scala.util.control.NonFatal(_) => () }
            throw error
        }
      } catch {
        case e: SQLException => throw JdbcFailure("database-unavailable", Option(e.getSQLState).filter(_.matches("[A-Z0-9]{5}")))
      }
    }
  })

  def migrate(namespace: String, migrations: List[Migration]): IO[Unit] =
    IO(Migration.validate(namespace, migrations)) *> transaction(c => Migration.applyAll(c, namespace, migrations))

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
    DriverManager.getConnection(config.jdbcUrl, props)
  }
}
object JdbcDatabase {
  def resource(config: JdbcConfig): Resource[IO, JdbcDatabase] =
    Resource.eval(IO.blocking { config.validate(); Class.forName("org.postgresql.Driver") }) *>
      Admission.resource(config.limits.admission).map(gate => new JdbcDatabase(config, gate))
}
