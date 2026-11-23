package ponygirls.runtime

import java.sql.Connection
import java.util.concurrent.{Semaphore, TimeUnit}
import scala.concurrent.duration.FiniteDuration

/** The transactions of a blocking facade, through one of its admissions. */
sealed trait BlockingJdbcTransactions {
  def transaction[A](f: Connection => A): A
  /** A transaction whose statements may run up to `timeout` (restart-robustness spec §4, publication), above the
    * configured statement timeout and a stricter role setting; lock and idle-in-transaction timeouts stay configured. */
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A
  /** A transaction each of whose waits ends within `bound` (restart-robustness spec §4, the transient failure record): the
    * admission wait, the connection's acquisition, each statement's lock wait and execution, each network read. */
  def boundedTransaction[A](bound: FiniteDuration)(f: Connection => A): A
}

/** Bounded blocking facade for existing synchronous JDBC domains. Call from blocking
  * threads, never http4s compute. No IORuntime, bridge or worker threads; one bounded pool.
  * Each instance is owned and closed; close rejects new work, drains admitted calls, then closes the pool.
  */
final class BlockingJdbcDatabase private (config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing)
    extends BlockingJdbcTransactions with AutoCloseable {
  def this(config: JdbcConfig) = this(config, JdbcConnectionFactory.driverManager, JdbcPoolSizing.compatible(config.limits))
  /** The services' pool (restart-robustness spec §5): request and background admissions over one pool of `sizing`. */
  def this(config: JdbcConfig, sizing: JdbcPoolSizing) = this(config, JdbcConnectionFactory.driverManager, sizing)
  private val engine = new JdbcTransactionEngine(config, factory, sizing)
  private val requests = new BlockingAdmission(config.limits.admission.copy(maxActive = sizing.request), engine)
  private val backgroundWork = if (sizing.background == 0) requests else new BlockingAdmission(config.limits.admission.copy(maxActive = sizing.background), engine)
  def transaction[A](f: Connection => A): A = requests.transaction(f)
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = requests.extendedTransaction(timeout)(f)
  def boundedTransaction[A](bound: FiniteDuration)(f: Connection => A): A = requests.boundedTransaction(bound)(f)
  /** The background view: the same pool through the background admission (the request admission without background
    * connections). */
  def background: BlockingJdbcTransactions = backgroundWork
  def migrate(namespace: String, migrations: List[Migration]): Unit = {
    Migration.validate(namespace, migrations)
    transaction(c => Migration.applyAll(c, namespace, migrations))
  }
  def close(): Unit = try {
    requests.reject(); backgroundWork.reject()
    requests.drain(); backgroundWork.drain()
  } finally engine.close()
}
object BlockingJdbcDatabase {
  /** Explicit trusted factory injection, with the same validated production config and
    * driver properties. Test probes can wrap a real PostgreSQL connection without
    * admitting custom/credential-bearing production JDBC URL syntaxes.
    */
  def withConnectionFactory(config: JdbcConfig, factory: JdbcConnectionFactory): BlockingJdbcDatabase =
    new BlockingJdbcDatabase(config, factory, JdbcPoolSizing.compatible(config.limits))
  def withConnectionFactory(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing): BlockingJdbcDatabase =
    new BlockingJdbcDatabase(config, factory, sizing)
}

/** Finite fair semaphore admission. Queued interruption frees the reservation and restores the interrupt flag; once
  * rejecting, new work fails `runtime-closed` and `drain` waits for admitted calls. */
private final class BlockingAdmission(policy: AdmissionConfig, engine: JdbcTransactionEngine) extends BlockingJdbcTransactions {
  policy.validate()
  private val permits = new Semaphore(policy.maxActive, true)
  private var closed = false
  private var admitted = 0

  private def reserve(): Unit = synchronized {
    if (closed) throw RuntimeFailure("runtime-closed")
    if (admitted >= policy.maxActive + policy.maxQueued) throw RuntimeFailure("admission-full")
    admitted += 1
  }
  private def release(): Unit = synchronized {
    admitted -= 1
    if (closed && admitted == 0) notifyAll()
  }
  def transaction[A](f: Connection => A): A = admitted(policy.queueTimeout)(engine.transaction(f))
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = admitted(policy.queueTimeout)(engine.extendedTransaction(timeout)(f))
  def boundedTransaction[A](bound: FiniteDuration)(f: Connection => A): A = admitted(policy.queueTimeout.min(bound))(engine.boundedTransaction(bound)(f))
  private def admitted[A](wait: FiniteDuration)(work: => A): A = {
    reserve()
    var acquired = false
    try {
      try acquired = permits.tryAcquire(wait.toNanos, TimeUnit.NANOSECONDS)
      catch { case _: InterruptedException => Thread.currentThread().interrupt(); throw RuntimeFailure("admission-interrupted") }
      if (!acquired) throw RuntimeFailure("admission-timeout")
      synchronized { if (closed) throw RuntimeFailure("runtime-closed") }
      work
    } finally {
      if (acquired) permits.release()
      release()
    }
  }
  def reject(): Unit = synchronized { closed = true }
  def drain(): Unit = synchronized {
    var interrupted = false
    while (admitted != 0) {
      try wait() catch { case _: InterruptedException => interrupted = true }
    }
    if (interrupted) Thread.currentThread().interrupt()
  }
}
