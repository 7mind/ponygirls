package ponygirls.runtime

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.lang.reflect.{InvocationHandler, InvocationTargetException, Method, Proxy}
import java.nio.file.Files
import java.sql.{Connection, DriverManager, PreparedStatement}
import java.util.Properties
import java.util.concurrent.{Callable, ConcurrentLinkedQueue, CountDownLatch, Executors, TimeUnit}
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}
import munit.FunSuite
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

// Behavioral/Active/Good-Communication: the pool against real PostgreSQL (restart-robustness spec §5, §7 D1-D6, D10).
final class PoolSuite extends FunSuite {
  import PostgresFixture.*
  private def configured[A](f: JdbcConfig => A): A = config.use(c => IO.blocking(f(c))).unsafeRunSync()
  private def scalar(c: Connection, sql: String): String = Using.resource(c.createStatement()) { s =>
    Using.resource(s.executeQuery(sql)) { r => r.next(); r.getString(1) }
  }
  private def pid(c: Connection): Int = integer(c, "SELECT pg_backend_pid()")

  /** Real PostgreSQL connections, counted; `wrap` may decorate the n-th (from 1). */
  private final class Counting(wrap: (Int, Connection) => Connection = (_, c) => c) extends JdbcConnectionFactory {
    val opened = new AtomicInteger
    val physical = new ConcurrentLinkedQueue[Connection]
    def open(url: String, properties: Properties): Connection = {
      val c = DriverManager.getConnection(url, properties)
      physical.add(c)
      wrap(opened.incrementAndGet(), c)
    }
  }
  /** The reset statement (`DISCARD ALL; ...`) of a decorated connection runs `before`, then itself, then `after`. */
  private def onReset(c: Connection, before: Connection => Unit, after: () => Unit): Connection =
    proxy(classOf[Connection], c) { (method, args) =>
      if (method.getName == "prepareStatement" && String.valueOf(args(0)).startsWith("DISCARD ALL")) {
        before(c)
        val statement = method.invoke(c, args*).asInstanceOf[PreparedStatement]
        Some(proxy(classOf[PreparedStatement], statement) { (m, a) =>
          if (m.getName == "execute") { val rows = m.invoke(statement, a*); after(); Some(rows) } else None
        })
      } else None
    }
  private def proxy[T](kind: Class[T], target: T)(intercept: (Method, Array[AnyRef]) => Option[AnyRef]): T =
    kind.cast(Proxy.newProxyInstance(kind.getClassLoader, Array[Class[?]](kind), new InvocationHandler {
      def invoke(self: AnyRef, method: Method, raw: Array[AnyRef]): AnyRef = {
        val args = Option(raw).getOrElse(Array.empty[AnyRef])
        try intercept(method, args).getOrElse(method.invoke(target, args*)) catch { case e: InvocationTargetException => throw e.getCause }
      }
    }))
  /** Stalls server-side; PostgreSQL ends the statement once it notices the closed client. */
  private def stall(c: Connection): Unit = {
    execute(c, "SET client_connection_check_interval = '100ms'")
    execute(c, "SELECT pg_sleep(30)")
  }
  /** A pool built while Hikari's alive-bypass window (no validation of a connection used this recently) is `window`. */
  private def withAliveBypass[A](window: Long)(build: => A): A = {
    val key = "com.zaxxer.hikari.aliveBypassWindowMs"
    System.setProperty(key, window.toString)
    try build finally System.clearProperty(key)
  }
  private def elapsed[A](work: => A): (A, FiniteDuration) = { val start = System.nanoTime(); val result = work; (result, (System.nanoTime() - start).nanos) }

  test("D1 a borrower's session state never reaches the next borrower of the same connection") { configured { config =>
    val factory = new Counting()
    Using.resource(BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = config.limits.copy(maxConnections = 1)), factory)) { db =>
      db.transaction(c => execute(c, "DROP ROLE IF EXISTS pool_probe; CREATE ROLE pool_probe NOLOGIN"))
      // A custom setting once set stays defined (empty) in the session: unset and empty both read 'unset'.
      def observed(c: Connection): List[String] = List(pid(c).toString, c.getNetworkTimeout.toString, c.getTransactionIsolation.toString, c.isReadOnly.toString,
        scalar(c, "SELECT concat_ws('|',current_setting('transaction_isolation'),current_setting('transaction_read_only'),current_setting('statement_timeout')," +
          "current_setting('work_mem'),coalesce(nullif(current_setting('hnsw.ef_search',true),''),'unset'),current_setting('search_path'),current_user,session_user," +
          "(SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()))"))
      try {
        val before = db.transaction(observed)
        val changed = db.transaction { c =>
          c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
          c.setReadOnly(true)
          execute(c, "SET statement_timeout = '1500ms'; SET LOCAL hnsw.ef_search = 321; SET LOCAL work_mem = '7MB'; SET search_path = pg_catalog; SET ROLE pool_probe")
          execute(c, "SELECT pg_advisory_lock(4242)")
          c.setNetworkTimeout((work: Runnable) => work.run(), 1234)
          observed(c)
        }
        val extended = db.extendedTransaction(2.seconds)(c => (pid(c), scalar(c, "SHOW statement_timeout"), c.getNetworkTimeout))
        val after = db.transaction(observed)
        assertNotEquals(changed, before)
        assertEquals(extended, (before.head.toInt, "2s", (2.seconds + config.limits.socketTimeout).toMillis.toInt))
        assertEquals(after, before)
        assertEquals(factory.opened.get, 1)
      } finally db.transaction(c => execute(c, "DROP ROLE pool_probe"))
    }
  } }

  test("D2 1,000 transactions open at most the pool's connections when cold and none when warm") { configured { config =>
    val factory = new Counting()
    Using.resource(BlockingJdbcDatabase.withConnectionFactory(config, factory)) { db =>
      val threads = config.limits.maxConnections
      val executor = Executors.newFixedThreadPool(threads)
      def thousand(): Int = {
        val runs = (1 to threads).map(_ => executor.submit(new Callable[Int] { def call(): Int = (1 to 1000 / threads).map(_ => db.transaction(c => integer(c, "SELECT 1"))).sum }))
        runs.map(_.get(60, TimeUnit.SECONDS)).sum
      }
      try {
        assertEquals(thousand(), 1000)
        val cold = factory.opened.get
        assertEquals(thousand(), 1000)
        assert(cold >= 1 && cold <= threads, s"cold opens $cold")
        assertEquals(factory.opened.get - cold, 0)
      } finally { executor.shutdownNow(); executor.awaitTermination(5, TimeUnit.SECONDS) }
    }
  } }

  test("D3 a pooled connection whose backend was terminated is evicted by the reset; the transaction runs on a new one") { configured { config =>
    val factory = new Counting()
    Using.resource(new BlockingJdbcDatabase(config)) { admin =>
      // Hikari would otherwise validate an idle connection; with the bypass the reset alone meets the dead connection (P15).
      Using.resource(withAliveBypass(Long.MaxValue)(BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = config.limits.copy(maxConnections = 1)), factory))) { db =>
        val first = db.transaction(pid)
        assertEquals(admin.transaction(c => scalar(c, s"SELECT pg_terminate_backend($first, 5000)")), "t")
        val second = db.transaction(pid)
        assertNotEquals(second, first)
        assertEquals(factory.opened.get, 2)
      }
    }
  } }

  test("D4 a rotated password serves new logins; a fenced role fails borrowers with connection-unavailable 28000, unfenced the same runtime recovers") { configured { config =>
    val password = Files.createTempFile("pool-login-", ".txt")
    Using.resource(new BlockingJdbcDatabase(config)) { admin =>
      def as(sql: String): Unit = admin.transaction(c => execute(c, sql))
      as("DROP ROLE IF EXISTS pool_login; CREATE ROLE pool_login LOGIN PASSWORD 'first-pool-password'")
      try {
        Files.writeString(password, "first-pool-password\n")
        val factory = new Counting()
        // A 3 s budget outlasts the login back-off a fenced 2.25 s borrow leaves (at most a 1.28 s sleep).
        val login = config.copy(user = "pool_login", passwordFile = password, limits = config.limits.copy(maxConnections = 2, connectTimeout = 3.seconds))
        Using.resource(BlockingJdbcDatabase.withConnectionFactory(login, factory)) { db =>
          val first = db.transaction(pid)
          as("ALTER ROLE pool_login PASSWORD 'second-pool-password'")
          Files.writeString(password, "second-pool-password\n")
          assertEquals(db.transaction(pid), first)
          val held = new CountDownLatch(1); val release = new CountDownLatch(1)
          val executor = Executors.newSingleThreadExecutor()
          try {
            val holder = executor.submit(new Callable[Int] { def call(): Int = db.transaction { c => held.countDown(); release.await(); pid(c) } })
            assert(held.await(10, TimeUnit.SECONDS))
            assertNotEquals(db.transaction(pid), first)
            release.countDown(); assertEquals(holder.get(10, TimeUnit.SECONDS), first)
          } finally { release.countDown(); executor.shutdownNow() }
          assertEquals(factory.opened.get, 2)
          as("ALTER ROLE pool_login NOLOGIN")
          admin.transaction(c => integer(c, "SELECT count(pg_terminate_backend(pid, 5000)) FROM pg_stat_activity WHERE usename = 'pool_login'"))
          val (fenced, took) = elapsed(intercept[JdbcFailure](db.transaction(pid)))
          assertEquals(fenced, JdbcFailure("connection-unavailable", Some("28000")))
          assert(took <= login.limits.queueTimeout + login.limits.connectTimeout, took.toString)
          as("ALTER ROLE pool_login LOGIN")
          assertNotEquals(db.transaction(pid), first)
        }
      } finally { as("DROP ROLE IF EXISTS pool_login"); Files.deleteIfExists(password) }
    }
  } }

  test("D5 acquisition: validated borrows fit a 1 s budget; stalled resets end within the budget; watchdog abort and handoff exclude each other") { configured { config =>
    import JdbcTransactionEngine.{Acquisition, Watchdog, acquisitionBudget}
    def engine(connectTimeout: FiniteDuration, factory: JdbcConnectionFactory, watchdog: Watchdog = JdbcTransactionEngine.scheduledWatchdog): JdbcTransactionEngine = {
      val limits = config.limits.copy(maxConnections = 1, connectTimeout = connectTimeout)
      new JdbcTransactionEngine(config.copy(limits = limits), factory, JdbcPoolSizing.compatible(limits), watchdog)
    }
    // (a) every borrow validated by the pool (bypass window -1), then reset: all within A = 1 s.
    Using.resource(withAliveBypass(-1)(engine(1.second, new Counting()))) { pool =>
      (1 to 20).foreach(_ => assertEquals(pool.transaction(c => scalar(c, "SHOW statement_timeout")), "3s"))
    }
    // (b) every reset stalls: two tries (one connection), each ended at its cap A/4, then connection-unavailable within A.
    val budget = acquisitionBudget(2.seconds)
    val stalled = new Counting((_, c) => onReset(c, stall, () => ()))
    Using.resource(engine(2.seconds, stalled)) { pool =>
      val (failure, took) = elapsed(intercept[JdbcFailure](pool.transaction(_ => fail("a stalled reset must not reach the callback"))))
      assertEquals(failure.code, "connection-unavailable")
      assert(took >= Acquisition(budget).resetCap * 2 && took < budget + 300.millis, took.toString)
      assertEquals(stalled.opened.get, 2)
    }
    // (c) only the first connection's reset stalls: evicted at the cap, the transaction runs on the second.
    val first = new Counting((n, c) => if (n == 1) onReset(c, stall, () => ()) else c)
    Using.resource(engine(2.seconds, first)) { pool =>
      val (_, took) = elapsed(pool.transaction(c => integer(c, "SELECT 1")))
      assert(took >= Acquisition(budget).resetCap && took < budget, took.toString)
      assertEquals(first.opened.get, 2)
    }
    // (d) production: A 5 s, V 1 s, reset cap 1.25 s; pooled connections retired after 30 min, kept alive every 2 min.
    assertEquals(acquisitionBudget(4200.millis), 5.seconds)
    assertEquals((Acquisition(5.seconds).validation, Acquisition(5.seconds).resetCap), (1.second, 1250.millis))
    assertEquals((JdbcTransactionEngine.maximumLifetime, JdbcTransactionEngine.keepaliveTime, JdbcTransactionEngine.idleTimeout), (30.minutes, 2.minutes, 10.minutes))
    // (e) the watchdog fires exactly when the test says: during the reset (abort wins), or once the reset handed over.
    val alarm = new AtomicReference[() => Unit]()
    val manual = new Watchdog { def arm(delay: FiniteDuration, fire: () => Unit): () => Unit = { alarm.set(fire); () => () } }
    val raced = new Counting((n, c) => if (n == 1) onReset(c, _ => (), () => alarm.get()()) else c)
    Using.resource(engine(2.seconds, raced, manual)) { pool =>
      val handed = pool.transaction { c => val before = pid(c); alarm.get()(); (before, pid(c)) }
      assertEquals(handed._1, handed._2)
      assertEquals(raced.opened.get, 2)
      assert(raced.physical.asScala.head.isClosed)
      assertEquals(pool.transaction(pid), handed._1)
    }
  } }

  test("D6 request and background admissions share one pool: a full background admission leaves requests served; closing closes the pool") { configured { config =>
    val limits = config.limits.copy(maxConnections = 4, maxQueued = 1)
    val sizing = JdbcPoolSizing.partitioned(limits, Some(1), Some(1), 0).toOption.get
    assertEquals((sizing.request, sizing.background, sizing.fixed), (1, 1, true))
    def scenario(request: (Connection => Int) => Int, background: (Connection => Int) => Int, close: () => Unit): Unit = {
      val held = new CountDownLatch(1); val release = new CountDownLatch(1)
      val executor = Executors.newSingleThreadExecutor()
      try {
        val holder = executor.submit(new Callable[Int] { def call(): Int = background { c => held.countDown(); release.await(); integer(c, "SELECT 1") } })
        assert(held.await(10, TimeUnit.SECONDS))
        assertEquals(request(c => integer(c, "SELECT 2")), 2)
        assertEquals(intercept[RuntimeFailure](background(_ => fail("a timed-out background waiter must not run"))).code, "admission-timeout")
        release.countDown(); assertEquals(holder.get(10, TimeUnit.SECONDS), 1)
      } finally { release.countDown(); executor.shutdownNow() }
      close()
      assertEquals(intercept[RuntimeFailure](request(_ => 0)).code, "runtime-closed")
      assertEquals(intercept[RuntimeFailure](background(_ => 0)).code, "runtime-closed")
    }
    val blocking = new Counting()
    val db = BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = limits), blocking, sizing)
    scenario(f => db.transaction(f), f => db.background.transaction(f), () => db.close())
    assert(blocking.opened.get <= sizing.connections && blocking.physical.asScala.forall(_.isClosed))
    val async = new Counting()
    val (database, close) = JdbcDatabase.resource(config.copy(limits = limits), sizing, async).allocated.unsafeRunSync()
    scenario(f => database.transaction(f).unsafeRunSync(), f => database.background.transaction(f).unsafeRunSync(), () => close.unsafeRunSync())
    assert(async.opened.get <= sizing.connections && async.physical.asScala.forall(_.isClosed))
  } }

  test("D10 a compatible pool opens no connection before its first transaction") { configured { config =>
    val factory = new Counting()
    Using.resource(BlockingJdbcDatabase.withConnectionFactory(config, factory)) { db =>
      assertEquals(factory.opened.get, 0)
      assertEquals(db.background.transaction(c => integer(c, "SELECT 1")), 1)
      assertEquals(factory.opened.get, 1)
    }
  } }
}
