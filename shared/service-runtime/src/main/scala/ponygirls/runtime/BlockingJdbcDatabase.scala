package ponygirls.runtime

import java.sql.Connection
import java.util.concurrent.{Semaphore, TimeUnit}
import scala.concurrent.duration.{Deadline, DurationInt, FiniteDuration}

/** The transactions of a blocking facade, through one of its admissions. */
sealed trait BlockingJdbcTransactions {
  def transaction[A](f: Connection => A): A
  /** A transaction whose statements may run up to `timeout` (restart-robustness spec §4, publication), above the
    * configured statement timeout and a stricter role setting; lock and idle-in-transaction timeouts stay configured. */
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A
  /** One try (R-a2 M1, the transient failure record) by `deadline` D: refused `admission-timeout` with less than
    * [[BlockingJdbcDatabase.minimumTry]] left; the admission waits at most min(`queueTimeoutMs`, D − now), read right
    * before its semaphore; then [[JdbcTransactionEngine.transactionWithin]] (acquisition, setup, statements and COMMIT by
    * D; `deadline-expired`). Callbacks use prepared statements with scalar values only: a refcursor value, or an unsupported
    * operation attempted after the deadline (reported as `deadline-expired`), is outside this guarantee (M1 gate, stated limits). */
  def transactionWithin[A](deadline: Deadline)(f: Connection => A): A
}

/** Bounded blocking facade for existing synchronous JDBC domains. Call from blocking
  * threads, never http4s compute. No IORuntime, bridge or worker threads; one bounded pool.
  * Each instance is owned and closed; close rejects new work, drains admitted calls, then closes the pool.
  */
final class BlockingJdbcDatabase private (config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing, reserve: Int, claim: AutoCloseable,
    trace: JdbcTransactionEngine.Trace) extends BlockingJdbcTransactions with AutoCloseable {
  private def this(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing, reserve: Int, claim: AutoCloseable) =
    this(config, factory, sizing, reserve, claim, JdbcTransactionEngine.Trace.none)
  def this(config: JdbcConfig) = this(config, JdbcConnectionFactory.driverManager, JdbcPoolSizing.compatible(config.limits), 0, ServicePool.unclaimed)
  /** A pool of `sizing` (restart-robustness spec §5): request and background admissions over one pool. */
  def this(config: JdbcConfig, sizing: JdbcPoolSizing) = this(config, JdbcConnectionFactory.driverManager, sizing, 0, ServicePool.unclaimed)
  /** With `reserve` connections of the background admission (of the one admission without one) as a reserved admission
    * of their own (spec §5 deviation A: Chronicle's lease renewals); none when that would leave the admission they come
    * from empty. A service's production wiring uses [[BlockingJdbcDatabase.service]]. */
  def this(config: JdbcConfig, sizing: JdbcPoolSizing, reserve: Int) = this(config, JdbcConnectionFactory.driverManager, sizing, reserve, ServicePool.unclaimed)
  require(reserve >= 0, "invalid reserved connections")
  private val engine = new JdbcTransactionEngine(config, factory, sizing, trace)
  private def admission(connections: Int) = new BlockingAdmission(config.limits.admission.copy(maxActive = connections), engine, trace)
  private val carved = if (reserve < (if (sizing.background == 0) sizing.request else sizing.background)) reserve else 0
  private val requests = admission(if (sizing.background == 0) sizing.request - carved else sizing.request)
  private val backgroundWork = if (sizing.background == 0) requests else admission(sizing.background - carved)
  private val reservedWork = if (carved == 0) backgroundWork else admission(carved)
  private val admissions = List(requests, backgroundWork, reservedWork).distinct
  def transaction[A](f: Connection => A): A = requests.transaction(f)
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = requests.extendedTransaction(timeout)(f)
  def transactionWithin[A](deadline: Deadline)(f: Connection => A): A = requests.transactionWithin(deadline)(f)
  /** The background view: the same pool through the background admission (the request admission without background
    * connections). */
  def background: BlockingJdbcTransactions = backgroundWork
  /** The reserved view: the same pool through the reserved admission, with its own `maxQueued` and `queueTimeoutMs`
    * bounds; without a reservation the background view. */
  def reserved: BlockingJdbcTransactions = reservedWork
  def migrate(namespace: String, migrations: List[Migration]): Unit = {
    Migration.validate(namespace, migrations)
    transaction(c => Migration.applyAll(c, namespace, migrations))
  }
  /** Every admission rejects new work before any drains; the pool closes after the drains, then a service pool's claim
    * is released. An interrupt of the closer neither shortens the drains nor the pool's shutdown: it is restored when both
    * are complete. */
  def close(): Unit = {
    admissions.foreach(_.reject())
    val interrupted = admissions.map(_.drain()).contains(true)
    try engine.close() finally claim.close()
    if (interrupted) Thread.currentThread().interrupt()
  }
}
object BlockingJdbcDatabase {
  /** The try-start policy of [[BlockingJdbcTransactions.transactionWithin]] (R-a2 M1): no try starts with less left to its
    * deadline. */
  val minimumTry: FiniteDuration = 100.millis
  /** Explicit trusted factory injection, with the same validated production config and
    * driver properties. Test probes can wrap a real PostgreSQL connection without
    * admitting custom/credential-bearing production JDBC URL syntaxes.
    */
  def withConnectionFactory(config: JdbcConfig, factory: JdbcConnectionFactory): BlockingJdbcDatabase =
    new BlockingJdbcDatabase(config, factory, JdbcPoolSizing.compatible(config.limits), 0, ServicePool.unclaimed)
  def withConnectionFactory(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing, reserve: Int = 0): BlockingJdbcDatabase =
    new BlockingJdbcDatabase(config, factory, sizing, reserve, ServicePool.unclaimed)
  /** As [[withConnectionFactory]], told of every try's admission and borrow (R-a2 M1 tests). */
  private[runtime] def traced(config: JdbcConfig, factory: JdbcConnectionFactory, sizing: JdbcPoolSizing, reserve: Int, trace: JdbcTransactionEngine.Trace): BlockingJdbcDatabase =
    new BlockingJdbcDatabase(config, factory, sizing, reserve, ServicePool.unclaimed, trace)
  /** The service's one pool of the process ([[ServicePool]]): fails `pool-already-open`, opening nothing, while another
    * service pool of the process is open; closing it releases the claim. */
  def service(config: JdbcConfig, sizing: JdbcPoolSizing, reserve: Int): BlockingJdbcDatabase = {
    val claim = ServicePool.claim()
    try new BlockingJdbcDatabase(config, JdbcConnectionFactory.driverManager, sizing, reserve, claim)
    catch { case error: Throwable => claim.close(); throw error }
  }
}

/** Finite fair semaphore admission. Queued interruption frees the reservation and restores the interrupt flag; once
  * rejecting, new work fails `runtime-closed` and `drain` waits for admitted calls, reporting (not restoring) an interrupt. */
private final class BlockingAdmission(policy: AdmissionConfig, engine: JdbcTransactionEngine, trace: JdbcTransactionEngine.Trace) extends BlockingJdbcTransactions {
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
  def transactionWithin[A](deadline: Deadline)(f: Connection => A): A = {
    val left = deadline.timeLeft
    if (left < BlockingJdbcDatabase.minimumTry) throw RuntimeFailure("admission-timeout")
    trace.admission(left)
    admitted(policy.queueTimeout.min(deadline.timeLeft))(engine.transactionWithin(deadline)(f))
  }
  /** `wait` is read after the reservation, right before the semaphore: a try's is what is left to its deadline then. */
  private def admitted[A](wait: => FiniteDuration)(work: => A): A = {
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
  def drain(): Boolean = synchronized {
    var interrupted = Thread.interrupted()
    while (admitted != 0) {
      try wait() catch { case _: InterruptedException => interrupted = true }
    }
    interrupted
  }
}
