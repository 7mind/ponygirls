package ponygirls.runtime

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import java.sql.{Connection, SQLException}

/** Sanitized SQLException preserves synchronous domain SQLState matching without raw
  * diagnostics/cause. Both blocking and IO facades return this same failure type.
  */
final case class JdbcFailure(code: String, sqlState: Option[String]) extends SQLException(code, sqlState.orNull)

/** One pooled connection per transaction, reset at each borrow. Running callbacks deliberately
  * defer cancellation until commit/rollback/return; use domain idempotency for uncertain
  * commits. Trusted callbacks must terminate and not escape/close/commit the connection.
  */
final class JdbcDatabase private (engine: JdbcTransactionEngine, gate: Admission, backgroundGate: Admission) {
  def transaction[A](f: Connection => A): IO[A] =
    gate.run(IO.uncancelable(_ => IO.blocking(engine.transaction(f))))

  def migrate(namespace: String, migrations: List[Migration]): IO[Unit] =
    IO(Migration.validate(namespace, migrations)) *> transaction(c => Migration.applyAll(c, namespace, migrations))

  /** The background view (restart-robustness spec §5): the same pool through the background admission (the request
    * admission without background connections). */
  lazy val background: JdbcDatabase = new JdbcDatabase(engine, backgroundGate, backgroundGate)
}
object JdbcDatabase {
  /** One admission of `maxConnections` over a pool opened on first use (rites, ontology, fixtures). */
  def resource(config: JdbcConfig): Resource[IO, JdbcDatabase] = resource(config, JdbcPoolSizing.compatible(config.limits))
  /** The services' pool: request and background admissions over one pool of `sizing`. Closing drains both admissions,
    * then closes the pool. */
  def resource(config: JdbcConfig, sizing: JdbcPoolSizing): Resource[IO, JdbcDatabase] =
    resource(config, sizing, JdbcConnectionFactory.driverManager)
  private[runtime] def resource(config: JdbcConfig, sizing: JdbcPoolSizing, factory: JdbcConnectionFactory): Resource[IO, JdbcDatabase] =
    Resource.make(IO.blocking(new JdbcTransactionEngine(config, factory, sizing)))(engine => IO.blocking(engine.close())).flatMap { engine =>
      for {
        gate <- Admission.resource(config.limits.admission.copy(maxActive = sizing.request))
        backgroundGate <- if (sizing.background == 0) Resource.pure[IO, Admission](gate)
          else Admission.resource(config.limits.admission.copy(maxActive = sizing.background))
      } yield new JdbcDatabase(engine, gate, backgroundGate)
    }
}
