package ponygirls.runtime

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.util.concurrent.{Callable, CountDownLatch, Executors, TimeUnit}
import munit.FunSuite
import scala.concurrent.duration.*
import scala.util.Using

// Behavioral/Active/Good-Communication. Same physical engine, no effects bridge.
final class BlockingPostgresSuite extends FunSuite {
  import PostgresFixture.*
  private def configured[A](f: JdbcConfig => A): A = config.use(c => IO.blocking(f(c))).unsafeRunSync()
  test("blocking facade uses same SQL deadlines, safe states and rollback engine") { configured { config =>
    Using.resource(new BlockingJdbcDatabase(config.copy(limits = config.limits.copy(statementTimeout = 100.millis)))) { db =>
      val expired = intercept[JdbcFailure](db.transaction(c => execute(c, "SELECT pg_sleep(2)")))
      assertEquals(expired.getSQLState, "57014"); assertEquals(expired.sqlState, Some("57014")); assertEquals(expired.getCause, null)
      val failure = intercept[JdbcFailure](db.transaction(c => execute(c, "SELECT pg_terminate_backend(pg_backend_pid())")))
      assertEquals(failure.getSuppressed.toList.map(_.asInstanceOf[JdbcFailure].code), List("database-rollback-failed"))
      assertEquals(db.transaction(c => integer(c, "SELECT 1")), 1)
    }
  } }
  test("blocking admission bounds active plus queued and waiting expires without callback") { configured { config =>
    Using.resource(new BlockingJdbcDatabase(config.copy(limits = config.limits.copy(maxConnections = 1, maxQueued = 1, queueTimeout = 300.millis)))) { db =>
      val executor = Executors.newFixedThreadPool(2)
      val entered = new CountDownLatch(1); val finish = new CountDownLatch(1)
      try {
        val active = executor.submit(new Callable[Int] { def call(): Int = db.transaction(c => { entered.countDown(); finish.await(); integer(c, "SELECT 1") }) })
        assert(entered.await(3,TimeUnit.SECONDS))
        val waiting = executor.submit(new Callable[String] { def call(): String = intercept[RuntimeFailure](db.transaction(_ => fail("expired waiter must not run"))).code })
        Thread.sleep(50)
        assertEquals(intercept[RuntimeFailure](db.transaction(_ => ())).code,"admission-full")
        assertEquals(waiting.get(3,TimeUnit.SECONDS),"admission-timeout")
        finish.countDown(); assertEquals(active.get(3,TimeUnit.SECONDS),1)
        assertEquals(db.transaction(c => integer(c,"SELECT 2")),2)
      } finally { finish.countDown(); executor.shutdownNow(); executor.awaitTermination(3,TimeUnit.SECONDS) }
    }
  } }
  test("interrupting a queued blocking caller frees reservation without releasing active JDBC") { configured { config =>
    Using.resource(new BlockingJdbcDatabase(config.copy(limits = config.limits.copy(maxConnections = 1, maxQueued = 1)))) { db =>
      val entered = new CountDownLatch(1); val finish = new CountDownLatch(1)
      val executor = Executors.newSingleThreadExecutor()
      val interrupted = new java.util.concurrent.atomic.AtomicBoolean(false)
      val result = new java.util.concurrent.atomic.AtomicReference[String]()
      val waiting = new Thread(() => {
        try db.transaction(_ => fail("interrupted waiter must not run")) catch { case e: RuntimeFailure => result.set(e.code); interrupted.set(Thread.currentThread().isInterrupted) }
      })
      try {
        val active = executor.submit(new Callable[Int] { def call(): Int = db.transaction(c => { entered.countDown(); finish.await(); integer(c,"SELECT 1") }) })
        assert(entered.await(3,TimeUnit.SECONDS)); waiting.start(); Thread.sleep(50); waiting.interrupt(); waiting.join(3000)
        assert(!waiting.isAlive); assertEquals(result.get(),"admission-interrupted"); assert(interrupted.get())
        finish.countDown(); active.get(3,TimeUnit.SECONDS)
        assertEquals(db.transaction(c => integer(c,"SELECT 2")),2)
      } finally { finish.countDown(); waiting.interrupt(); waiting.join(3000); executor.shutdownNow(); executor.awaitTermination(3,TimeUnit.SECONDS) }
    }
  } }
  test("blocking shutdown drains live transaction and rejects new calls") { configured { config =>
    val db = new BlockingJdbcDatabase(config)
    val entered = new CountDownLatch(1); val finish = new CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(2)
    try {
      val active = executor.submit(new Callable[Int] { def call(): Int = db.transaction(c => { entered.countDown(); finish.await(); integer(c,"SELECT 1") }) })
      assert(entered.await(3,TimeUnit.SECONDS))
      val closing = executor.submit(new Callable[Unit] { def call(): Unit = db.close() })
      Thread.sleep(50); assert(!closing.isDone)
      assertEquals(intercept[RuntimeFailure](db.transaction(_ => ())).code,"runtime-closed")
      finish.countDown(); assertEquals(active.get(3,TimeUnit.SECONDS),1); closing.get(3,TimeUnit.SECONDS)
      assertEquals(intercept[RuntimeFailure](db.transaction(_ => ())).code,"runtime-closed")
    } finally { finish.countDown(); db.close(); executor.shutdownNow(); executor.awaitTermination(3,TimeUnit.SECONDS) }
  } }
}
