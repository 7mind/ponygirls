package ponygirls.runtime

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.sql.{Connection, SQLException}

/** Sanitized SQLException preserves synchronous domain SQLState matching without raw
  * diagnostics/cause. Both blocking and IO facades return this same failure type.
  */
final case class JdbcFailure(code: String, sqlState: Option[String]) extends SQLException(code, sqlState.orNull)

/** One scoped connection per transaction, not a pool. Running callbacks deliberately
  * defer cancellation until commit/rollback/close; use domain idempotency for uncertain
  * commits. Trusted callbacks must terminate and not escape/close/commit the connection.
  */
final class JdbcDatabase private (engine: JdbcTransactionEngine, gate: Admission) {
  def transaction[A](f: Connection => A): IO[A] =
    gate.run(IO.uncancelable(_ => IO.blocking(engine.transaction(f))))

  def migrate(namespace: String, migrations: List[Migration]): IO[Unit] =
    IO(Migration.validate(namespace, migrations)) *> transaction(c => Migration.applyAll(c, namespace, migrations))
}
object JdbcDatabase {
  def resource(config: JdbcConfig): Resource[IO, JdbcDatabase] =
    Resource.eval(IO.blocking(new JdbcTransactionEngine(config, JdbcConnectionFactory.driverManager))).flatMap { engine =>
      Admission.resource(config.limits.admission).map(gate => new JdbcDatabase(engine, gate))
    }
}
