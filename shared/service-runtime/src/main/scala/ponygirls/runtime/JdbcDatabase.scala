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
  /** A pool of `sizing`: request and background admissions over one pool. Closing rejects new work in both admissions,
    * then drains both, then closes the pool. A service's production wiring uses [[service]]. */
  def resource(config: JdbcConfig, sizing: JdbcPoolSizing): Resource[IO, JdbcDatabase] =
    resource(config, sizing, JdbcConnectionFactory.driverManager)
  /** The service's one pool of the process ([[ServicePool]]): fails `pool-already-open`, opening nothing, while another
    * service pool of the process is open; the claim is released after the pool closed. */
  def service(config: JdbcConfig, sizing: JdbcPoolSizing): Resource[IO, JdbcDatabase] =
    Resource.make(IO(ServicePool.claim()))(claim => IO(claim.close())) *> resource(config, sizing)
  private[runtime] def resource(config: JdbcConfig, sizing: JdbcPoolSizing, factory: JdbcConnectionFactory): Resource[IO, JdbcDatabase] =
    Resource.make(IO.blocking(new JdbcTransactionEngine(config, factory, sizing)))(engine => IO.blocking(engine.close())).flatMap { engine =>
      val admissions = for {
        gate <- Admission.create(config.limits.admission.copy(maxActive = sizing.request))
        backgroundGate <- if (sizing.background == 0) IO.pure(gate) else Admission.create(config.limits.admission.copy(maxActive = sizing.background))
      } yield (gate, backgroundGate)
      Resource.make(admissions) { case (gate, backgroundGate) => gate.reject *> backgroundGate.reject *> gate.drain *> backgroundGate.drain }
        .map { case (gate, backgroundGate) => new JdbcDatabase(engine, gate, backgroundGate) }
    }
}

/** One service pool per process (restart-robustness spec §5): each service's production wiring builds its pool through
  * `JdbcDatabase.service` or `BlockingJdbcDatabase.service`, which hold this claim from before the pool is built until it
  * has closed; another claim meanwhile fails `pool-already-open`. Every other constructor (rites, ontology, test fixtures,
  * which build many runtimes in one JVM) takes none. */
object ServicePool {
  val AlreadyOpen = "pool-already-open"
  private val held = new java.util.concurrent.atomic.AtomicBoolean(false)
  private[runtime] def claim(): AutoCloseable = {
    if (!held.compareAndSet(false, true)) throw RuntimeFailure(AlreadyOpen)
    val released = new java.util.concurrent.atomic.AtomicBoolean(false)
    () => if (released.compareAndSet(false, true)) held.set(false)
  }
  private[runtime] val unclaimed: AutoCloseable = () => ()
}
