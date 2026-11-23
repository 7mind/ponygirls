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
  /** A decorated connection runs `after` once its reset statement (`DISCARD ALL; ...`) has executed. */
  private def afterReset(c: Connection, after: () => Unit): Connection =
    proxy(classOf[Connection], c) { (method, args) =>
      if (method.getName == "prepareStatement" && String.valueOf(args(0)).startsWith("DISCARD ALL")) {
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
  /** Another session's transaction holding `pg_settings` exclusively while taken: every statement reading it (the reset's
    * bounds, a bounded transaction's setup) waits server-side, after the reset's `DISCARD ALL`, until `release`. */
  private final class SettingsLock(config: JdbcConfig) extends AutoCloseable {
    private val holder = { val p = new Properties; p.setProperty("user", config.user); p.setProperty("password", CredentialFile.read(config.passwordFile)); DriverManager.getConnection(config.jdbcUrl, p) }
    holder.setAutoCommit(false)
    def take(): Unit = execute(holder, "LOCK TABLE pg_catalog.pg_settings IN ACCESS EXCLUSIVE MODE")
    def release(): Unit = holder.rollback()
    def close(): Unit = try holder.rollback() finally holder.close()
  }
  private def engine(config: JdbcConfig, connectTimeout: FiniteDuration, factory: JdbcConnectionFactory,
      watchdog: JdbcTransactionEngine.Watchdog = JdbcTransactionEngine.scheduledWatchdog, nanoTime: () => Long = () => System.nanoTime()): JdbcTransactionEngine = {
    val limits = config.limits.copy(maxConnections = 1, connectTimeout = connectTimeout)
    new JdbcTransactionEngine(config.copy(limits = limits), factory, JdbcPoolSizing.compatible(limits), watchdog, nanoTime)
  }
  /** Waits (no fixed time) until `condition` holds; the bound only keeps a broken run from hanging. */
  private def eventually(what: String)(condition: => Boolean): Unit = {
    val bound = System.nanoTime() + 10.seconds.toNanos
    while (!condition) { assert(System.nanoTime() < bound, what); Thread.onSpinWait() }
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
      // The pool never validates on borrow: the reset alone meets the dead connection (P15).
      Using.resource(BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = config.limits.copy(maxConnections = 1)), factory)) { db =>
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
        // The fenced borrow waits its whole 2 s budget while the pool retries logins with a doubling back-off from 10 ms: the
        // sleep in progress at its end is at most 1.28 s (begun after 1.27 s of back-off), so the next 2 s borrow outlasts it.
        val login = config.copy(user = "pool_login", passwordFile = password, limits = config.limits.copy(maxConnections = 2, connectTimeout = 2.seconds))
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

  test("D5 acquisition: a budget below the pool's validation timeout is usable; stalled reset executions end within the budget; watchdog abort and handoff exclude each other") { configured { config =>
    import JdbcTransactionEngine.{Acquisition, Watchdog, acquisitionBudget}
    // (a) A 300 ms budget below V (1 s at A = 5 s) borrows an idle connection: the pool never validates on borrow (with the
    // window -1 it would, for up to V; this validation would stall until the end of the test).
    val stalling = new java.util.concurrent.atomic.AtomicBoolean(false); val validations = new AtomicInteger; val unstall = new CountDownLatch(1)
    val validating = new Counting((_, c) => proxy(classOf[Connection], c) { (m, _) =>
      if (m.getName == "isValid" && stalling.get) { validations.incrementAndGet(); unstall.await(10, TimeUnit.SECONDS); Some(java.lang.Boolean.TRUE) } else None })
    try Using.resource(withAliveBypass(-1)(engine(config, 5.seconds, validating))) { pool =>
      pool.transaction(pid)
      stalling.set(true)
      val (selected, took) = elapsed(pool.boundedTransaction(300.millis)(c => integer(c, "SELECT 1")))
      assertEquals((selected, validations.get), (1, 0))
      assert(took < Acquisition(5.seconds).validation, took.toString)
    } finally unstall.countDown()
    // (b) every reset execution stalls server-side (its bounds wait for pg_settings after DISCARD ALL): two tries (one
    // connection), each ended at its cap A/4 by the network timeout and the watchdog, then connection-unavailable within A.
    val budget = acquisitionBudget(2.seconds)
    Using.resource(new SettingsLock(config)) { lock =>
      lock.take()
      val stalled = new Counting()
      Using.resource(engine(config, 2.seconds, stalled)) { pool =>
        val (failure, took) = elapsed(intercept[JdbcFailure](pool.transaction(_ => fail("a stalled reset must not reach the callback"))))
        assertEquals(failure.code, "connection-unavailable")
        assert(took >= Acquisition(budget).resetCap * 2 && took < budget + 300.millis, took.toString)
        assertEquals(stalled.opened.get, 2)
      }
    }
    // (c) only the first connection's reset stalls (the lock goes when the second logs in): evicted at the cap, the
    // transaction runs on the second.
    Using.resource(new SettingsLock(config)) { lock =>
      lock.take()
      val first = new Counting((n, c) => { if (n == 2) lock.release(); c })
      Using.resource(engine(config, 2.seconds, first)) { pool =>
        val (_, took) = elapsed(pool.transaction(c => integer(c, "SELECT 1")))
        assert(took >= Acquisition(budget).resetCap && took < budget, took.toString)
        assertEquals(first.opened.get, 2)
      }
    }
    // (d) production: A 5 s, V 1 s (the keepalive's validation), reset cap 1.25 s; connections retired after 30 min, kept
    // alive every 2 min.
    assertEquals(acquisitionBudget(4200.millis), 5.seconds)
    assertEquals((Acquisition(5.seconds).validation, Acquisition(5.seconds).resetCap), (1.second, 1250.millis))
    assertEquals((JdbcTransactionEngine.maximumLifetime, JdbcTransactionEngine.keepaliveTime, JdbcTransactionEngine.idleTimeout), (30.minutes, 2.minutes, 10.minutes))
    // (e) the watchdog fires exactly when the test says: during the reset (abort wins), or once the reset handed over.
    val alarm = new AtomicReference[() => Unit]()
    val manual = new Watchdog { def arm(delay: FiniteDuration, fire: () => Unit): () => Unit = { alarm.set(fire); () => () } }
    val raced = new Counting((n, c) => if (n == 1) afterReset(c, () => alarm.get()()) else c)
    Using.resource(engine(config, 2.seconds, raced, manual)) { pool =>
      val handed = pool.transaction { c => val before = pid(c); alarm.get()(); (before, pid(c)) }
      assertEquals(handed._1, handed._2)
      assertEquals(raced.opened.get, 2)
      assert(raced.physical.asScala.head.isClosed)
      assertEquals(pool.transaction(pid), handed._1)
    }
  } }

  test("D5 a reset that ends after its cap is not handed over although its alarm comes late; a remainder below a millisecond borrows without waiting") { configured { config =>
    import JdbcTransactionEngine.{Acquisition, Watchdog, acquisitionBudget}
    val arms = new AtomicInteger
    // Every alarm arrives too late to abort anything.
    val late = new Watchdog { def arm(delay: FiniteDuration, fire: () => Unit): () => Unit = { arms.incrementAndGet(); () => () } }
    // (a) On the engine's clock the first connection's reset ends 1 ms after its cap (A 2 s: cap 500 ms), long before the
    // deadline: evicted, the transaction runs on a second connection.
    val skew = new java.util.concurrent.atomic.AtomicLong(0)
    val cap = Acquisition(acquisitionBudget(2.seconds)).resetCap
    val slow = new Counting((n, c) => if (n == 1) afterReset(c, () => { skew.addAndGet((cap + 1.milli).toNanos); () }) else c)
    Using.resource(engine(config, 2.seconds, slow, late, () => System.nanoTime() + skew.get)) { pool =>
      assertEquals(pool.transaction(c => integer(c, "SELECT 1")), 1)
      assertEquals(slow.opened.get, 2)
      eventually("the over-cap connection is closed")(slow.physical.asScala.head.isClosed)
    }
    // (b) A 1 ms bound whose remainder is 0.5 ms at the borrow (the engine's clock) takes the idle connection without
    // waiting and resets it (the bound's statements may then time out at 1 ms: not asserted).
    val idle = new Counting()
    val start = new java.util.concurrent.atomic.AtomicLong(0); val reads = new AtomicInteger
    val halfway = () => if (start.get == 0) System.nanoTime() else if (reads.getAndIncrement() == 0) start.get else start.get + 500.micros.toNanos
    Using.resource(engine(config, 2.seconds, idle, late, halfway)) { pool =>
      pool.transaction(pid)
      arms.set(0); start.set(System.nanoTime())
      scala.util.Try(pool.boundedTransaction(1.milli)(_ => 0))
      assertEquals((arms.get, idle.opened.get), (1, 1))
    }
  } }

  test("D5 a bounded transaction's network timeout covers its first statement: a stalled setup ends at the bound, not the socket timeout") { configured { config =>
    // Statement and lock waits long; the socket timeout 5 s; the bound 1 s. The setup statement reads pg_settings, which
    // another session takes right after the reset.
    val waits = config.copy(limits = config.limits.copy(statementTimeout = 30.seconds, lockTimeout = 30.seconds))
    val bound = 1.second
    Using.resource(new SettingsLock(config)) { lock =>
      val armed = new java.util.concurrent.atomic.AtomicBoolean(true)
      val factory = new Counting((_, c) => proxy(classOf[Connection], c) { (m, a) =>
        if (m.getName == "setAutoCommit" && a(0) == java.lang.Boolean.FALSE && armed.compareAndSet(true, false)) lock.take()
        None
      })
      Using.resource(engine(waits, 5.seconds, factory)) { pool =>
        val (failure, took) = elapsed(intercept[JdbcFailure](pool.boundedTransaction(bound)(_ => fail("the setup must not complete"))))
        assertEquals((failure.code, failure.sqlState), ("database-unavailable", Some("08006")))
        assert(took >= bound && took < bound + 700.millis && took < waits.limits.socketTimeout, took.toString)
      }
    }
  } }

  test("D5 a reset that throws (an interruption, a failing watchdog) evicts its connection: a one-connection pool serves the next borrow") { configured { config =>
    val arms = new AtomicInteger
    val throwing = new JdbcTransactionEngine.Watchdog {
      def arm(delay: FiniteDuration, fire: () => Unit): () => Unit = arms.incrementAndGet() match {
        case 1 => throw new InterruptedException()
        case 2 => throw new IllegalStateException("watchdog unavailable")
        case _ => JdbcTransactionEngine.scheduledWatchdog.arm(delay, fire)
      }
    }
    val factory = new Counting()
    Using.resource(engine(config, 2.seconds, factory, throwing)) { pool =>
      // munit's intercept passes fatal throwables (InterruptedException) through.
      assert(try { pool.transaction(pid); false } catch { case _: InterruptedException => true })
      intercept[IllegalStateException](pool.transaction(pid))
      pool.transaction(pid)
      assertEquals(factory.opened.get, 3)
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

  test("D6 closing rejects work in both admissions before draining either, drains latched work, then closes the pool; an interrupted blocking closer completes the shutdown") { configured { config =>
    val limits = config.limits.copy(maxConnections = 4, maxQueued = 1)
    val sizing = JdbcPoolSizing.partitioned(limits, Some(1), Some(1), 0).toOption.get
    val executor = Executors.newFixedThreadPool(2)
    def holding(background: (Connection => Int) => Int): (CountDownLatch, java.util.concurrent.Future[Int]) = {
      val held = new CountDownLatch(1); val release = new CountDownLatch(1)
      val holder = executor.submit(new Callable[Int] { def call(): Int = background { c => held.countDown(); release.await(); integer(c, "SELECT 1") } })
      assert(held.await(10, TimeUnit.SECONDS))
      (release, holder)
    }
    try {
      // Blocking facade: the closer waits in the background drain; both views reject meanwhile; the pool stays open until
      // the latched work ends; the interrupted closer returns only once the pool has closed its connections (each close
      // held until the test lets it go), with the interrupt restored.
      val closeStarted = new CountDownLatch(1); val closeable = new CountDownLatch(1)
      val blocking = new Counting((_, c) => proxy(classOf[Connection], c) { (m, _) =>
        if (m.getName == "close") { closeStarted.countDown(); closeable.await(10, TimeUnit.SECONDS); c.close(); Some(null) } else None })
      val db = BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = limits), blocking, sizing)
      val (release, holder) = holding(f => db.background.transaction(f))
      val after = new AtomicReference[(Boolean, Boolean)]()
      val closer = new Thread(() => { db.close(); after.set((Thread.currentThread().isInterrupted, blocking.physical.asScala.forall(_.isClosed))) })
      closer.start()
      eventually("the closer drains")(closer.getState == Thread.State.WAITING)
      assertEquals(intercept[RuntimeFailure](db.transaction(_ => 0)).code, "runtime-closed")
      assertEquals(intercept[RuntimeFailure](db.background.transaction(_ => 0)).code, "runtime-closed")
      closer.interrupt()
      assert(!holder.isDone && blocking.physical.asScala.exists(!_.isClosed))
      release.countDown(); assertEquals(holder.get(10, TimeUnit.SECONDS), 1)
      eventually("the pool closes a connection")(closeStarted.getCount == 0)
      assert(closer.isAlive, "close returned before the pool closed its connections")
      closeable.countDown(); closer.join(10000)
      assertEquals(after.get, (true, true))
      // IO facade: the finalizer rejects both admissions before it waits for the background drain.
      val async = new Counting()
      val (database, close) = JdbcDatabase.resource(config.copy(limits = limits), sizing, async).allocated.unsafeRunSync()
      val (asyncRelease, asyncHolder) = holding(f => database.background.transaction(f).unsafeRunSync())
      val closing = close.unsafeToFuture()
      eventually("requests are rejected")(database.transaction(_ => 0).attempt.unsafeRunSync() == Left(RuntimeFailure("runtime-closed")))
      assertEquals(database.background.transaction(_ => 0).attempt.unsafeRunSync(), Left(RuntimeFailure("runtime-closed")))
      assert(!asyncHolder.isDone && !closing.isCompleted && async.physical.asScala.exists(!_.isClosed))
      asyncRelease.countDown(); assertEquals(asyncHolder.get(10, TimeUnit.SECONDS), 1)
      scala.concurrent.Await.result(closing, 10.seconds)
      assert(async.physical.asScala.forall(_.isClosed))
    } finally { executor.shutdownNow(); executor.awaitTermination(5, TimeUnit.SECONDS) }
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
