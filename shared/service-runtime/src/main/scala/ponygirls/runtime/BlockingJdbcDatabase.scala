package ponygirls.runtime

import java.sql.Connection
import java.util.concurrent.{Semaphore, TimeUnit}
import scala.concurrent.duration.FiniteDuration

/** Bounded blocking facade for existing synchronous JDBC domains. Call from blocking
  * threads, never http4s compute. No IORuntime, bridge, worker threads or connection pool.
  * Each instance is owned and closed; close rejects new work and drains admitted calls.
  */
final class BlockingJdbcDatabase private (config: JdbcConfig, factory: JdbcConnectionFactory) extends AutoCloseable {
  def this(config: JdbcConfig) = this(config, JdbcConnectionFactory.driverManager)
  private val engine = new JdbcTransactionEngine(config, factory)
  private val policy = config.limits.admission
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
  /** A transaction whose statements may run up to `timeout` (restart-robustness spec §4, publication), above the
    * configured statement timeout and a stricter role setting; lock and idle-in-transaction timeouts stay configured. */
  def extendedTransaction[A](timeout: FiniteDuration)(f: Connection => A): A = admitted(policy.queueTimeout)(engine.extendedTransaction(timeout)(f))
  /** A transaction each of whose waits ends within `bound` (restart-robustness spec §4, the transient failure record): the
    * admission wait, the login, each statement's lock wait and execution, each network read. */
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
  def migrate(namespace: String, migrations: List[Migration]): Unit = {
    Migration.validate(namespace, migrations)
    transaction(c => Migration.applyAll(c, namespace, migrations))
  }
  def close(): Unit = synchronized {
    closed = true
    var interrupted = false
    while (admitted != 0) {
      try wait() catch { case _: InterruptedException => interrupted = true }
    }
    if (interrupted) Thread.currentThread().interrupt()
  }
}
object BlockingJdbcDatabase {
  /** Explicit trusted factory injection, with the same validated production config and
    * driver properties. Test probes can wrap a real PostgreSQL connection without
    * admitting custom/credential-bearing production JDBC URL syntaxes.
    */
  def withConnectionFactory(config: JdbcConfig, factory: JdbcConnectionFactory): BlockingJdbcDatabase =
    new BlockingJdbcDatabase(config, factory)
}
