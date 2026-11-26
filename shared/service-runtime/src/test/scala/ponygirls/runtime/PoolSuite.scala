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

  /** Real PostgreSQL connections, counted; `wrap` may decorate the n-th (from 1); `login` runs before the n-th login
    * attempt (it may block or refuse it), on the thread that logs in. */
  private final class Counting(wrap: (Int, Connection) => Connection = (_, c) => c, login: Int => Unit = _ => ()) extends JdbcConnectionFactory {
    val opened = new AtomicInteger
    val logins = new AtomicInteger
    val threads = new ConcurrentLinkedQueue[String]
    val physical = new ConcurrentLinkedQueue[Connection]
    def open(url: String, properties: Properties): Connection = {
      threads.add(Thread.currentThread().getName)
      login(logins.incrementAndGet())
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
  /** Another session's transaction holding an advisory lock exclusively while taken. A session logged in through
    * [[SettingsLock.sessions]] resolves the engine's unqualified `set_config` to the fixture's function of that name, which
    * waits for the lock before it sets: every statement calling it (the reset's bounds, a bounded transaction's setup) waits
    * server-side, after the reset's `DISCARD ALL`, until `release`. */
  private final class SettingsLock(config: JdbcConfig) extends AutoCloseable {
    import SettingsLock.*
    private val holder = { val p = new Properties; p.setProperty("user", config.user); p.setProperty("password", CredentialFile.read(config.passwordFile)); DriverManager.getConnection(config.jdbcUrl, p) }
    execute(holder, s"CREATE SCHEMA IF NOT EXISTS $Schema; CREATE OR REPLACE FUNCTION $Schema.set_config(text, text, boolean) RETURNS text LANGUAGE sql AS " +
      s"$$$$ SELECT pg_advisory_xact_lock_shared($Key); SELECT pg_catalog.set_config($$1, $$2, $$3) $$$$")
    holder.setAutoCommit(false)
    def take(): Unit = execute(holder, s"SELECT pg_advisory_xact_lock($Key)")
    def release(): Unit = holder.rollback()
    def close(): Unit = try { holder.rollback(); holder.setAutoCommit(true); execute(holder, s"DROP SCHEMA $Schema CASCADE") } finally holder.close()
  }
  private object SettingsLock {
    val Schema = "settings_lock"
    val Key = 7405
    /** `factory`'s logins with the fixture's schema before `pg_catalog` in their search path: a startup option, which the
      * reset's `DISCARD ALL` returns the session to. */
    def sessions(factory: JdbcConnectionFactory): JdbcConnectionFactory = new JdbcConnectionFactory {
      def open(url: String, properties: Properties): Connection = { properties.setProperty("options", s"-c search_path=$Schema,pg_catalog"); factory.open(url, properties) }
    }
  }
  private def engine(config: JdbcConfig, connectTimeout: FiniteDuration, factory: JdbcConnectionFactory,
      watchdog: JdbcTransactionEngine.Watchdog = JdbcTransactionEngine.scheduledWatchdog, nanoTime: () => Long = () => System.nanoTime(),
      trace: JdbcTransactionEngine.Trace = JdbcTransactionEngine.Trace.none): JdbcTransactionEngine = {
    val limits = config.limits.copy(maxConnections = 1, connectTimeout = connectTimeout)
    new JdbcTransactionEngine(config.copy(limits = limits), factory, JdbcPoolSizing.compatible(limits), watchdog, nanoTime, trace)
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
  /** A watchdog whose alarms never come. */
  private val never = new JdbcTransactionEngine.Watchdog { def arm(delay: FiniteDuration, fire: () => Unit): () => Unit = () => () }
  /** An engine clock: the real one until [[play]], then the played readings in order, the last one repeated. */
  private final class Scripted extends (() => Long) {
    private var readings: Option[List[Long]] = None
    private var last = 0L
    def play(values: Long*): Unit = synchronized { readings = Some(values.toList) }
    def apply(): Long = synchronized {
      readings match {
        case None => System.nanoTime()
        case Some(next :: rest) => readings = Some(rest); last = next; next
        case Some(Nil) => last
      }
    }
  }
  /** The `Trace` of R-a2 M1: each try's admission (time left to D) and each borrow (its remainder). */
  private final class Recorded extends JdbcTransactionEngine.Trace {
    val admissions = new ConcurrentLinkedQueue[FiniteDuration]
    val borrows = new ConcurrentLinkedQueue[FiniteDuration]
    val threads = new ConcurrentLinkedQueue[Thread]
    val admitted = new CountDownLatch(1)
    val borrowed = new CountDownLatch(1)
    def admission(left: FiniteDuration): Unit = { admissions.add(left); threads.add(Thread.currentThread()); admitted.countDown() }
    def borrow(remaining: FiniteDuration): Unit = { borrows.add(remaining); borrowed.countDown() }
    /** T1i (3): no admission with less than `minimumTry` left to D; no borrow of an expired remainder. */
    def floors(): Unit = assert(admissions.asScala.forall(_ >= BlockingJdbcDatabase.minimumTry) && borrows.asScala.forall(_ > Duration.Zero),
      (admissions.asScala.toList, borrows.asScala.toList).toString)
  }

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
      val (selected, took) = elapsed(pool.transactionWithin(Deadline.now + 300.millis)(c => integer(c, "SELECT 1")))
      assertEquals((selected, validations.get), (1, 0))
      assert(took < Acquisition(5.seconds).validation, took.toString)
    } finally unstall.countDown()
    // (b) every reset execution stalls server-side (its bounds wait for the settings lock after DISCARD ALL): two tries (one
    // connection), each ended at its cap A/4 by the network timeout and the watchdog, then connection-unavailable within A.
    val budget = acquisitionBudget(2.seconds)
    Using.resource(new SettingsLock(config)) { lock =>
      lock.take()
      val stalled = new Counting()
      Using.resource(engine(config, 2.seconds, SettingsLock.sessions(stalled))) { pool =>
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
      Using.resource(engine(config, 2.seconds, SettingsLock.sessions(first))) { pool =>
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

  test("D5 a reset that ends after its cap is not handed over although its alarm comes late; T1i (2a) a remainder below a millisecond borrows once without waiting, (2b) an expired one not at all; the deadline is checked after the network timeout is set") { configured { config =>
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
    // (b) T1i (2a): a try (D 30 s away) whose acquisition budget leaves 0.5 ms at the borrow (the engine's clock: the
    // deadline's conversion and the acquisition's start read `now`, the borrow `now + A − 0.5 ms`) takes the idle connection
    // without waiting and resets it once; (2b) with the remainder expired at the borrow, it borrows nothing and fails
    // connection-unavailable before its callback.
    val resets = new AtomicInteger
    val idle = new Counting((_, c) => afterReset(c, () => { resets.incrementAndGet(); () }))
    val script = new Scripted; val trace = new Recorded
    val budget = acquisitionBudget(2.seconds).toNanos
    Using.resource(engine(config, 2.seconds, idle, late, script, trace)) { pool =>
      pool.transaction(pid)
      resets.set(0); trace.borrows.clear()
      val now = System.nanoTime()
      script.play(now, now, now + budget - 500.micros.toNanos)
      assertEquals(pool.transactionWithin(Deadline.now + 30.seconds)(c => integer(c, "SELECT 1")), 1)
      val borrowed = trace.borrows.asScala.toList
      assert(borrowed.size == 1 && borrowed.forall(r => r > Duration.Zero && r.toMillis == 0), borrowed.toString)
      assertEquals((resets.get, idle.opened.get), (1, 1))
      trace.borrows.clear()
      val later = System.nanoTime()
      script.play(later, later, later + budget)
      assertEquals(intercept[JdbcFailure](pool.transactionWithin(Deadline.now + 30.seconds)(_ => fail("an expired remainder borrows nothing"))).code, "connection-unavailable")
      assertEquals((trace.borrows.size, resets.get, idle.opened.get), (0, 1, 1))
      trace.floors()
    }
    // (2c) The same 0.5 ms remainder with an empty bag (the pool's only login held): exactly one borrow, which finds nothing,
    // then connection-unavailable.
    val login = new CountDownLatch(1)
    val empty = new Counting(login = _ => { login.await(10, TimeUnit.SECONDS); () })
    val emptyScript = new Scripted; val polls = new Recorded
    Using.resource(engine(config, 2.seconds, empty, late, emptyScript, polls)) { pool =>
      try {
        val now = System.nanoTime()
        emptyScript.play(now, now, now + budget - 500.micros.toNanos)
        assertEquals(intercept[JdbcFailure](pool.transactionWithin(Deadline.now + 30.seconds)(_ => fail("the bag is empty"))).code, "connection-unavailable")
        assertEquals((polls.borrows.size, empty.opened.get), (1, 0))
        polls.floors()
      } finally login.countDown()
    }
    // (c) The deadline passes while the transaction's own network timeout is installed (the first setter after the reset
    // executed, on the engine's clock): the connection goes back to the pool, unused, and the callback never runs.
    val crossing = new java.util.concurrent.atomic.AtomicLong(0); val reset = new java.util.concurrent.atomic.AtomicBoolean(false)
    val once = new java.util.concurrent.atomic.AtomicBoolean(true)
    val pausing = new Counting((_, c) => proxy(classOf[Connection], afterReset(c, () => reset.set(true))) { (m, _) =>
      if (m.getName == "setNetworkTimeout" && reset.get && once.compareAndSet(true, false)) crossing.addAndGet(acquisitionBudget(2.seconds).toNanos)
      None
    })
    Using.resource(engine(config, 2.seconds, pausing, late, () => System.nanoTime() + crossing.get)) { pool =>
      assertEquals(intercept[JdbcFailure](pool.transaction(_ => fail("handed over after the deadline"))).code, "connection-unavailable")
      assertEquals(pool.transaction(pid) > 0, true)
      assertEquals(pausing.opened.get, 1)
    }
  } }

  test("D5 a try's network timeout covers its first statement: a stalled setup ends at D, not the socket timeout") { configured { config =>
    // Statement and lock waits long; the socket timeout 5 s; D 1 s away, its transaction watch never fires. The setup
    // statement waits for the settings lock, which another session takes right after the reset.
    val waits = config.copy(limits = config.limits.copy(statementTimeout = 30.seconds, lockTimeout = 30.seconds))
    val bound = 1.second
    Using.resource(new SettingsLock(config)) { lock =>
      val armed = new java.util.concurrent.atomic.AtomicBoolean(true)
      val factory = new Counting((_, c) => proxy(classOf[Connection], c) { (m, a) =>
        if (m.getName == "setAutoCommit" && a(0) == java.lang.Boolean.FALSE && armed.compareAndSet(true, false)) lock.take()
        None
      })
      Using.resource(engine(waits, 5.seconds, SettingsLock.sessions(factory), never)) { pool =>
        val (failure, took) = elapsed(intercept[JdbcFailure](pool.transactionWithin(Deadline.now + bound)(_ => fail("the setup must not complete"))))
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

  test("D6 closing rejects work in every admission (request, background, reserved) before draining any, drains latched work, then closes the pool; an interrupted blocking closer completes the shutdown") { configured { config =>
    val limits = config.limits.copy(maxConnections = 5, maxQueued = 1)
    val sizing = JdbcPoolSizing.partitioned(limits, Some(1), Some(2), 0).toOption.get
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
      val db = BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = limits), blocking, sizing, 1)
      val (release, holder) = holding(f => db.background.transaction(f))
      val after = new AtomicReference[(Boolean, Boolean)]()
      val closer = new Thread(() => { db.close(); after.set((Thread.currentThread().isInterrupted, blocking.physical.asScala.forall(_.isClosed))) })
      closer.start()
      eventually("the closer drains")(closer.getState == Thread.State.WAITING)
      assertEquals(intercept[RuntimeFailure](db.transaction(_ => 0)).code, "runtime-closed")
      assertEquals(intercept[RuntimeFailure](db.background.transaction(_ => 0)).code, "runtime-closed")
      assertEquals(intercept[RuntimeFailure](db.reserved.transaction(_ => 0)).code, "runtime-closed")
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

  test("a reserved admission (Chronicle's renewals) is served while the background admission it is carved from is latched full; small budgets") { configured { config =>
    // Background 3 = a background admission of 2 + the reserved 1 (max 7: 2 + 3 ≤ 7 − 2), the background admission latched.
    val limits = config.limits.copy(maxConnections = 7)
    val sizing = JdbcPoolSizing.partitioned(limits, Some(2), Some(3), 0).toOption.get
    val executor = Executors.newFixedThreadPool(2)
    def latched(db: BlockingJdbcDatabase, holders: Int, hold: (Connection => Int) => Int): Unit = {
      val held = new CountDownLatch(holders); val release = new CountDownLatch(1)
      val running = (1 to holders).map(_ => executor.submit(new Callable[Int] { def call(): Int = hold { c => held.countDown(); release.await(); integer(c, "SELECT 1") } }))
      try {
        assert(held.await(10, TimeUnit.SECONDS))
        assertEquals(intercept[RuntimeFailure](db.background.transaction(_ => fail("the latched admission is full"))).code, "admission-timeout")
        assertEquals(db.reserved.transaction(c => integer(c, "SELECT 2")), 2)
      } finally release.countDown()
      running.foreach(holder => assertEquals(holder.get(10, TimeUnit.SECONDS), 1))
    }
    try {
      Using.resource(BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = limits), new Counting(), sizing, 1))(db => latched(db, 2, f => db.background.transaction(f)))
      // Compatible, 2 connections: one admission of 1 (requests and background) + the reserved 1.
      val two = config.limits.copy(maxConnections = 2)
      Using.resource(BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = two), new Counting(), JdbcPoolSizing.compatible(two), 1))(db => latched(db, 1, f => db.transaction(f)))
      // One connection: one admission for everything, the reserved view included.
      val one = config.limits.copy(maxConnections = 1)
      Using.resource(BlockingJdbcDatabase.withConnectionFactory(config.copy(limits = one), new Counting(), JdbcPoolSizing.compatible(one), 1)) { db =>
        val held = new CountDownLatch(1); val release = new CountDownLatch(1)
        val holder = executor.submit(new Callable[Int] { def call(): Int = db.transaction { c => held.countDown(); release.await(); integer(c, "SELECT 1") } })
        try {
          assert(held.await(10, TimeUnit.SECONDS))
          assertEquals(intercept[RuntimeFailure](db.reserved.transaction(_ => fail("one admission"))).code, "admission-timeout")
        } finally release.countDown()
        assertEquals(holder.get(10, TimeUnit.SECONDS), 1)
      }
    } finally { executor.shutdownNow(); executor.awaitTermination(5, TimeUnit.SECONDS) }
  } }

  test("one service pool per process: another service pool fails pool-already-open until the first has closed; other constructors take no claim") { configured { config =>
    val sizing = JdbcPoolSizing.compatible(config.limits)
    val first = BlockingJdbcDatabase.service(config, sizing, 0)
    try {
      assertEquals(intercept[RuntimeFailure](BlockingJdbcDatabase.service(config, sizing, 0)).code, ServicePool.AlreadyOpen)
      assertEquals(JdbcDatabase.service(config, sizing).use(_ => IO.unit).attempt.unsafeRunSync(), Left(RuntimeFailure(ServicePool.AlreadyOpen)))
      Using.resource(new BlockingJdbcDatabase(config, sizing))(db => assertEquals(db.transaction(c => integer(c, "SELECT 1")), 1))
      assertEquals(first.transaction(c => integer(c, "SELECT 1")), 1)
    } finally first.close()
    assertEquals(JdbcDatabase.service(config, sizing).use(db => db.transaction(c => integer(c, "SELECT 1"))).unsafeRunSync(), 1)
    Using.resource(BlockingJdbcDatabase.service(config, sizing, 0))(db => assertEquals(db.transaction(c => integer(c, "SELECT 1")), 1))
  } }

  test("D10 a compatible pool opens no connection before its first transaction") { configured { config =>
    val factory = new Counting()
    Using.resource(BlockingJdbcDatabase.withConnectionFactory(config, factory)) { db =>
      assertEquals(factory.opened.get, 0)
      assertEquals(db.background.transaction(c => integer(c, "SELECT 1")), 1)
      assertEquals(factory.opened.get, 1)
    }
  } }

  test("a fixed pool opens its connections at start, before any transaction; with one login fewer left to its role (another session holds it) it opens the rest, serves, retries the refused login (53300) in the background and is full once that session ends: its six connections hold six callbacks at once, without another login") { configured { config =>
    // The callbacks hold their transactions open until all have entered.
    val limits = config.limits.copy(maxConnections = 8, idleTransactionTimeout = 30.seconds)
    val sizing = JdbcPoolSizing.partitioned(limits, None, None, 0).toOption.get
    val password = Files.createTempFile("pool-limit-", ".txt")
    Using.resource(plain(config)) { admin =>
      execute(admin, s"DROP ROLE IF EXISTS pool_limited; CREATE ROLE pool_limited LOGIN PASSWORD 'limited-pool-password' CONNECTION LIMIT ${sizing.connections}")
      try {
        Files.writeString(password, "limited-pool-password\n")
        val login = config.copy(user = "pool_limited", passwordFile = password, limits = limits)
        val counting = new Counting()
        val refused = new ConcurrentLinkedQueue[String]
        val factory = new JdbcConnectionFactory {
          def open(url: String, properties: Properties): Connection =
            try counting.open(url, properties) catch { case e: java.sql.SQLException => refused.add(e.getSQLState); throw e }
        }
        val held = plain(login)
        val executor = Executors.newFixedThreadPool(sizing.connections)
        val release = new CountDownLatch(1)
        try Using.resource(BlockingJdbcDatabase.withConnectionFactory(login, factory, sizing)) { db =>
          try {
            eventually("the logins left are open and the last one was refused twice")(counting.opened.get == sizing.connections - 1 && refused.size >= 2)
            assertEquals((sizing.fixed, refused.asScala.toSet, backends(admin, "usename = 'pool_limited'")), (true, Set("53300"), sizing.connections))
            assertEquals(db.transaction(c => integer(c, "SELECT 1")), 1)
            held.close()
            eventually("the refused login succeeds")(counting.opened.get == sizing.connections)
            val logins = counting.logins.get
            val entered = new ConcurrentLinkedQueue[Int]
            def hold(view: BlockingJdbcTransactions) = executor.submit(new Callable[Int] { def call(): Int = view.transaction { c => entered.add(pid(c)); release.await(); 1 } })
            val holders = List.fill(sizing.request)(hold(db)) ++ List.fill(sizing.background)(hold(db.background))
            eventually("every callback holds a connection or one has ended")(entered.size == sizing.connections || holders.exists(_.isDone))
            assertEquals((entered.asScala.toSet.size, counting.logins.get), (sizing.connections, logins),
              holders.filter(_.isDone).map(h => scala.util.Try(h.get)).toString)
            release.countDown()
            assertEquals(holders.map(_.get(10, TimeUnit.SECONDS)).sum, sizing.connections)
          } finally release.countDown()
        } finally { held.close(); executor.shutdownNow() }
      } finally { execute(admin, "DROP ROLE IF EXISTS pool_limited"); Files.deleteIfExists(password) }
    }
  } }

  // R-a2 M1 (RA2-SPEC section-r5 §3): one deadline D per try. Budgets: A 8 s (reset cap 2 s); statement, lock, socket and
  // idle-in-transaction waits 30 s; D = start + 2.5 s unless stated; a phase holds H = 1 s; each case checks its phase's
  // bound + 0.5 s. The order of events is forced by latches, the `Trace` or the engine's clock; H only spends budget.
  private val within = 2500.millis
  private val held = 1.second
  private val allowance = 500.millis
  private def m1(config: JdbcConfig): JdbcConfig = config.copy(limits = config.limits.copy(connectTimeout = 8.seconds, statementTimeout = 30.seconds,
    lockTimeout = 30.seconds, idleTransactionTimeout = 30.seconds, socketTimeout = 30.seconds))
  private def hold(): Unit = Thread.sleep(held.toMillis)
  /** `m1_probe` with row 1, its row lock held by `locker` until it rolls back or closes. */
  private def lockedRow(admin: Connection, locker: Connection): Unit = {
    execute(admin, "DROP TABLE IF EXISTS m1_probe; CREATE TABLE m1_probe(id int PRIMARY KEY, value int NOT NULL); INSERT INTO m1_probe VALUES (1, 0)")
    locker.setAutoCommit(false)
    execute(locker, "SELECT value FROM m1_probe WHERE id = 1 FOR UPDATE")
  }
  private val update = "UPDATE m1_probe SET value = value + 1 WHERE id = 1"
  /** Waits until a backend of this database waits for a lock in a statement starting with `statement`: its pid and the
    * statement's start (server clock). */
  private def lockWait(admin: Connection, statement: String): (Int, String) = {
    var found = Option.empty[(Int, String)]
    eventually(s"a lock wait in $statement") {
      found = Using.resource(admin.prepareStatement("SELECT pid, query_start::text FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND ltrim(query) LIKE ?")) { p =>
        p.setString(1, statement + "%")
        Using.resource(p.executeQuery())(r => if (r.next()) Some((r.getInt(1), r.getString(2))) else None)
      }
      found.nonEmpty
    }
    found.get
  }
  private def backends(admin: Connection, condition: String): Int = integer(admin, s"SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND $condition")
  /** A try on its own thread: its outcome and the instant it ended. */
  private def attempt[A](executor: java.util.concurrent.ExecutorService)(work: => A): java.util.concurrent.Future[(scala.util.Try[A], Deadline)] =
    executor.submit(new Callable[(scala.util.Try[A], Deadline)] { def call(): (scala.util.Try[A], Deadline) = { val outcome = scala.util.Try(work); (outcome, Deadline.now) } })
  /** A try cut at D: by its watch (`deadline-expired`) or, as close to D, by a timeout its setup set (57014, 55P03). */
  private def cut(outcome: scala.util.Try[?]): Unit = outcome.failed.toOption match {
    case Some(JdbcFailure("deadline-expired", _)) | Some(JdbcFailure(_, Some("57014" | "55P03"))) => ()
    case other => fail(s"not cut at D: ${other.collect { case f: JdbcFailure => (f.code, f.sqlState) }.getOrElse(other)}")
  }
  private def raise(c: Connection): Unit = execute(c, "DO $$ BEGIN RAISE EXCEPTION 'permanent'; END $$")

  test("M1 T1i (1) a try with less than minimumTry left to D is refused admission-timeout before its admission and any borrow; production floors") { configured { config =>
    val trace = new Recorded; val factory = new Counting()
    Using.resource(BlockingJdbcDatabase.traced(config, factory, JdbcPoolSizing.compatible(config.limits), 0, trace)) { db =>
      assertEquals(intercept[RuntimeFailure](db.background.transactionWithin(Deadline.now + 50.millis)(_ => fail("no try starts"))).code, "admission-timeout")
      assertEquals((trace.admissions.size, trace.borrows.size, factory.logins.get), (0, 0, 0))
    }
    assertEquals(BlockingJdbcDatabase.minimumTry, 100.millis)
  } }

  test("M1 T1a one D bounds the background admission and the statements after it: a try that waited H in the permit's queue, then for a row lock, ends by D + 0.5 s; one delayed H at its reservation waits for the permit only until D") { configured { base =>
    val config = m1(base)
    val limits = config.limits.copy(maxConnections = 4, queueTimeout = 30.seconds)
    val sizing = JdbcPoolSizing.partitioned(limits, Some(1), Some(1), 0).toOption.get
    val trace = new Recorded; val executor = Executors.newCachedThreadPool()
    val permit = new CountDownLatch(1); val release = new CountDownLatch(1)
    def waiting(n: Int, state: Thread.State): Thread = {
      eventually(s"try $n enters its admission")(trace.threads.size >= n)
      val thread = trace.threads.asScala.toList(n - 1)
      eventually(s"try $n is $state in the admission")(thread.getState == state && thread.getStackTrace.exists(_.getClassName == "ponygirls.runtime.BlockingAdmission"))
      thread
    }
    try Using.resources(plain(config), plain(config), BlockingJdbcDatabase.traced(config.copy(limits = limits), new Counting(), sizing, 0, trace)) { (admin, locker, db) =>
      try {
        lockedRow(admin, locker)
        val holder = executor.submit(new Callable[Int] { def call(): Int = db.background.transaction { _ => permit.countDown(); release.await(); 1 } })
        assert(permit.await(10, TimeUnit.SECONDS))
        // (2) The try is delayed H between its check and its reservation (the admission's monitor held by the test), the
        // permit still held: its wait for the permit is what is left to D then, not the time sampled before.
        val admission = db.background
        val delayedDeadline = Deadline.now + within
        val delayed = admission.synchronized {
          val tried = attempt(executor)(admission.transactionWithin(delayedDeadline)(_ => fail("the permit is held")))
          waiting(1, Thread.State.BLOCKED)
          hold()
          tried
        }
        val (delayedOutcome, delayedEnd) = delayed.get(30, TimeUnit.SECONDS)
        assert(delayedEnd <= delayedDeadline + allowance, s"ended ${delayedEnd - delayedDeadline} after D")
        assertEquals(delayedOutcome.failed.toOption, Some(RuntimeFailure("admission-timeout")))
        // (1) The try waits H in the permit's queue (observed), then for the row lock.
        val deadline = Deadline.now + within
        val tried = attempt(executor)(db.background.transactionWithin(deadline)(c => execute(c, update)))
        waiting(2, Thread.State.TIMED_WAITING)
        hold()
        release.countDown(); assertEquals(holder.get(10, TimeUnit.SECONDS), 1)
        lockWait(admin, update)
        val (outcome, ended) = tried.get(30, TimeUnit.SECONDS)
        assert(ended <= deadline + allowance, s"ended ${ended - deadline} after D")
        cut(outcome)
        trace.floors()
      } finally release.countDown()
    } finally executor.shutdownNow()
  } }

  test("M1 T1b one D bounds the acquisition and the statements after it: a try whose login took H (on the pool's adder), then waited for a row lock, ends by D + 0.5 s") { configured { base =>
    val config = m1(base)
    val entered = new CountDownLatch(1); val release = new CountDownLatch(1)
    val factory = new Counting(login = n => if (n == 1) { entered.countDown(); release.await(10, TimeUnit.SECONDS); () })
    val trace = new Recorded; val executor = Executors.newSingleThreadExecutor()
    try Using.resources(plain(config), plain(config), engine(config, 8.seconds, factory, trace = trace)) { (admin, locker, pool) =>
      try {
        lockedRow(admin, locker)
        val deadline = Deadline.now + within
        val tried = attempt(executor)(pool.transactionWithin(deadline)(c => execute(c, update)))
        assert(entered.await(10, TimeUnit.SECONDS) && trace.borrowed.await(10, TimeUnit.SECONDS))
        assert(factory.threads.asScala.forall(_.endsWith("connection-adder")), factory.threads.toString)
        hold()
        release.countDown()
        lockWait(admin, update)
        val (outcome, ended) = tried.get(30, TimeUnit.SECONDS)
        assert(ended <= deadline + allowance, s"ended ${ended - deadline} after D")
        cut(outcome)
        trace.floors()
      } finally release.countDown()
    } finally executor.shutdownNow()
  } }

  test("M1 T1d a reset waiting in the server ends at D before its cap: connection-unavailable by D + 0.5 s") { configured { base =>
    val config = m1(base)
    import JdbcTransactionEngine.{Acquisition, acquisitionBudget}
    val cap = Acquisition(acquisitionBudget(8.seconds)).resetCap
    val trace = new Recorded; val executor = Executors.newSingleThreadExecutor()
    try Using.resources(plain(config), new SettingsLock(config), engine(config, 8.seconds, SettingsLock.sessions(new Counting()), trace = trace)) { (admin, lock, pool) =>
      pool.transaction(pid)
      lock.take()
      val start = Deadline.now; val deadline = start + 800.millis
      val tried = attempt(executor)(pool.transactionWithin(deadline)(_ => fail("a stalled reset must not reach the callback")))
      lockWait(admin, "SELECT set_config(v.name")
      val (outcome, ended) = tried.get(30, TimeUnit.SECONDS)
      assertEquals(outcome.failed.toOption.collect { case JdbcFailure(code, _) => code }, Some("connection-unavailable"))
      assert(ended <= deadline + allowance && ended < start + cap, s"ended ${ended - start} after the start")
      trace.floors()
    } finally executor.shutdownNow()
    assertEquals(cap, 2.seconds)
  } }

  test("M1 T1f a COMMIT waiting in the server is cut at D: the caller fails by D + 0.5 s and evicts; the backend waits on (released, it commits; kept, it ends by COMMIT start + (D - setup))") { configured { base =>
    val config = m1(base)
    Using.resource(plain(config)) { admin =>
      execute(admin, "DROP TABLE IF EXISTS m1_commit; CREATE TABLE m1_commit(id int NOT NULL)")
      execute(admin, "CREATE OR REPLACE FUNCTION m1_commit_wait() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(4711); RETURN NULL; END $$")
      execute(admin, "CREATE CONSTRAINT TRIGGER m1_commit_wait AFTER INSERT ON m1_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION m1_commit_wait()")
      try List(1 -> true, 2 -> false).foreach { (row, released) =>
        val trace = new Recorded; val factory = new Counting(); val executor = Executors.newSingleThreadExecutor()
        try Using.resources(plain(config), engine(config, 8.seconds, factory, trace = trace)) { (locker, pool) =>
          execute(locker, "SELECT pg_advisory_lock(4711)")
          val backend = new AtomicInteger; val setupLockTimeout = new AtomicInteger
          val deadline = Deadline.now + within
          val tried = attempt(executor)(pool.transactionWithin(deadline) { c =>
            backend.set(pid(c)); setupLockTimeout.set(integer(c, "SELECT setting::int FROM pg_settings WHERE name = 'lock_timeout'"))
            execute(c, s"INSERT INTO m1_commit VALUES ($row)"); hold()
          })
          val (waiting, commitStart) = lockWait(admin, "COMMIT")
          val (outcome, ended) = tried.get(30, TimeUnit.SECONDS)
          assert(ended <= deadline + allowance, s"ended ${ended - deadline} after D")
          assertEquals(outcome.failed.toOption.collect { case JdbcFailure(code, _) => code }, Some("deadline-expired"))
          assertEquals(waiting, backend.get)
          assertEquals(backends(admin, s"pid = $waiting AND wait_event_type = 'Lock'"), 1, "the backend still waits after the caller failed")
          eventually("the connection is evicted")(factory.physical.asScala.head.isClosed)
          if (released) execute(locker, "SELECT pg_advisory_unlock(4711)")
          eventually("the backend ends")(backends(admin, s"pid = $waiting") == 0)
          val sinceCommit = scalar(admin, s"SELECT extract(epoch FROM clock_timestamp() - '$commitStart'::timestamptz) * 1000").toDouble
          if (!released) assert(sinceCommit <= setupLockTimeout.get + allowance.toMillis, s"ended $sinceCommit ms after COMMIT start, lock timeout ${setupLockTimeout.get} ms")
          assertEquals(integer(admin, s"SELECT count(*)::int FROM m1_commit WHERE id = $row"), if (released) 1 else 0)
          trace.floors()
        } finally executor.shutdownNow()
      } finally execute(admin, "DROP TABLE m1_commit; DROP FUNCTION m1_commit_wait()")
    }
  } }

  test("M1 T1h a failure keeps its SQLSTATE: a P0001 whose ROLLBACK hangs is ended by the abort at D (P0001, evicted); one raised after D sends no ROLLBACK; after D no statement is prepared or executed, through any handle; unguarded handles refused") { configured { base =>
    val config = m1(base)
    // (a) The first connection's ROLLBACK waits until the connection is aborted (at most 10 s), then reaches the driver.
    val aborted = new CountDownLatch(1); val rollbacks = new AtomicInteger
    val frozen = new Counting((n, c) => if (n > 1) c else proxy(classOf[Connection], c) { (m, a) => m.getName match {
      case "abort" => m.invoke(c, a*); aborted.countDown(); Some(null)
      case "rollback" if a.isEmpty => rollbacks.incrementAndGet(); aborted.await(10, TimeUnit.SECONDS); None
      case _ => None
    } })
    val trace = new Recorded
    Using.resource(engine(config, 8.seconds, frozen, trace = trace)) { pool =>
      val first = new AtomicInteger
      val deadline = Deadline.now + within
      val failure = intercept[JdbcFailure](pool.transactionWithin(deadline) { c => first.set(pid(c)); raise(c) })
      assert(Deadline.now <= deadline + allowance, s"ended ${Deadline.now - deadline} after D")
      assertEquals((failure.code, failure.sqlState, rollbacks.get), ("database-unavailable", Some("P0001"), 1))
      assertEquals(failure.getSuppressed.toList.collect { case JdbcFailure(code, _) => code }, List("database-rollback-failed"))
      assertNotEquals(pool.transaction(pid), first.get)
    }
    // (b) The callback moves the engine's clock past D, its watch never firing: (1) its own error, thrown then, is kept; (2) a
    // statement it prepares after D and (3) one it prepared before D never reach the driver (deadline-expired); (4) neither
    // does one prepared after D through a handle obtained before D (its result set's statement's connection); no
    // ROLLBACK; each connection evicted. The driver's proxy counts the marked statements prepared and executed.
    val marker = "m1_after_deadline"
    val skew = new java.util.concurrent.atomic.AtomicLong(0); val rolled = new AtomicInteger
    val preparations = new AtomicInteger; val executed = new AtomicInteger
    val counted = new Counting((_, c) => proxy(classOf[Connection], c) { (m, a) => m.getName match {
      case "rollback" => rolled.incrementAndGet(); None
      case "prepareStatement" if String.valueOf(a(0)).contains(marker) =>
        preparations.incrementAndGet()
        val prepared = m.invoke(c, a*).asInstanceOf[PreparedStatement]
        Some(proxy(classOf[PreparedStatement], prepared) { (e, _) => if (e.getName.startsWith("execute")) executed.incrementAndGet(); None })
      case _ => None
    } })
    Using.resource(engine(config, 8.seconds, counted, never, () => System.nanoTime() + skew.get, trace)) { pool =>
      def pastDeadline(): Unit = skew.set((within + 1.second).toNanos)
      def evicting(work: Connection => Unit): JdbcFailure = {
        val first = new AtomicInteger
        val failure = intercept[JdbcFailure](pool.transactionWithin(Deadline.now + within) { c => first.set(pid(c)); work(c) })
        skew.set(0)
        assertNotEquals(pool.transaction(pid), first.get)
        failure
      }
      val own = evicting { _ => pastDeadline(); throw new java.sql.SQLException("synthetic permanent failure", "P0001") }
      val prepared = evicting { c => pastDeadline(); Using.resource(c.prepareStatement(s"SELECT '$marker'"))(_.executeQuery()); () }
      val executedLate = evicting { c => Using.resource(c.prepareStatement(s"SELECT '$marker'")) { p => pastDeadline(); p.executeQuery() }; () }
      val escaped = evicting { c =>
        Using.resource(c.createStatement()) { s =>
          val read = s.executeQuery("SELECT 1"); pastDeadline()
          Using.resource(read.getStatement.getConnection.prepareStatement(s"SELECT '$marker'"))(_.executeQuery())
        }; ()
      }
      assertEquals((own.code, own.sqlState), ("database-unavailable", Some("P0001")))
      assertEquals(List(prepared, executedLate, escaped), List.fill(3)(JdbcFailure("deadline-expired", None)))
      assertEquals((preparations.get, executed.get, rolled.get), (1, 0, 0))
      // (c) Handles that would reach the server unguarded are refused before D, nothing sent: the database metadata, the
      // driver's connection, statement and result set.
      val refused = JdbcFailure("deadline-unsupported", None)
      val kept = pool.transactionWithin(Deadline.now + within) { c =>
        Using.resource(c.createStatement()) { s =>
          Using.resource(s.executeQuery("SELECT 1")) { read =>
            (List(scala.util.Try(c.getMetaData), scala.util.Try(c.unwrap(classOf[org.postgresql.PGConnection])),
              scala.util.Try(s.unwrap(classOf[org.postgresql.PGStatement])), scala.util.Try(read.unwrap(classOf[org.postgresql.jdbc.PgResultSet])),
              scala.util.Try(read.getMetaData)).map(_.failed.toOption), c.isWrapperFor(classOf[org.postgresql.PGConnection]))
          }
        }
      }
      assertEquals(kept, (List.fill(5)(Some(refused)), false))
    }
    trace.floors()
  } }

  test("M1 T1j the transaction watch: fired in the callback (deadline-expired, no ROLLBACK, evicted); after the call (nothing aborted); withheld past D (refused before COMMIT); from inside COMMIT (deadline-expired, outcome unknown)") { configured { base =>
    val config = m1(base)
    import JdbcTransactionEngine.Watchdog
    // The latest alarm is the transaction watch's (armed after the reset's).
    val alarm = new AtomicReference[() => Unit]()
    val manual = new Watchdog { def arm(delay: FiniteDuration, fire: () => Unit): () => Unit = { alarm.set(fire); () => () } }
    val skew = new java.util.concurrent.atomic.AtomicLong(0); val rollbacks = new AtomicInteger; val committing = new AtomicInteger(0)
    val factory = new Counting((_, c) => proxy(classOf[Connection], c) { (m, a) => m.getName match {
      case "rollback" => rollbacks.incrementAndGet(); None
      case "commit" => committing.getAndSet(0) match {
        case 1 => alarm.get()(); None
        case 2 => m.invoke(c, a*); alarm.get()(); throw new java.sql.SQLException("the reply was lost")
        case _ => None
      }
      case _ => None
    } })
    val trace = new Recorded
    Using.resources(plain(config), engine(config, 8.seconds, factory, manual, () => System.nanoTime() + skew.get, trace)) { (admin, pool) =>
      execute(admin, "DROP TABLE IF EXISTS m1_rows; CREATE TABLE m1_rows(id int NOT NULL)")
      def rows(id: Int): Int = integer(admin, s"SELECT count(*)::int FROM m1_rows WHERE id = $id")
      def insert(c: Connection, id: Int): Int = { execute(c, s"INSERT INTO m1_rows VALUES ($id)"); pid(c) }
      def expired(id: Int)(work: Connection => Unit): (JdbcFailure, Int) = {
        val used = new AtomicInteger
        val failure = intercept[JdbcFailure](pool.transactionWithin(Deadline.now + within) { c => used.set(insert(c, id)); work(c) })
        assertEquals(failure.code, "deadline-expired")
        skew.set(0)
        assertNotEquals(pool.transaction(pid), used.get, "evicted")
        (failure, used.get)
      }
      // (a) Fired in the callback: the next statement meets the aborted connection.
      val (inCallback, _) = expired(1) { c => alarm.get()(); pid(c) }
      assert(inCallback.sqlState.forall(_.startsWith("08")), inCallback.toString)
      assertEquals(rows(1), 0)
      // (b) Fired after the call returned: nothing is aborted; the same connection serves the next borrow.
      val kept = pool.transactionWithin(Deadline.now + within)(insert(_, 2))
      alarm.get()()
      assertEquals((pool.transaction(pid), rows(2)), (kept, 1))
      // (c) Withheld while the callback moves the engine's clock past D: refused before COMMIT.
      assertEquals(expired(3)(_ => skew.set((within + 1.second).toNanos))._1, JdbcFailure("deadline-expired", None))
      assertEquals(rows(3), 0)
      // (d) Fired inside COMMIT: (1) before it is sent, (2) after it took effect, its reply lost (no SQLSTATE).
      committing.set(1); expired(4)(_ => ())
      committing.set(2); assertEquals(expired(5)(_ => ())._1, JdbcFailure("deadline-expired", None))
      assertEquals((rows(4), rows(5), rollbacks.get), (0, 1, 0))
      execute(admin, "DROP TABLE m1_rows")
    }
    trace.floors()
  } }

  test("M1 T4b-i after a restart the stale pooled connections fail their resets at once and are evicted; the try then takes the next new login") { configured { base =>
    val config = m1(base)
    val limits = config.limits.copy(maxConnections = 5)
    val sizing = JdbcPoolSizing.partitioned(limits, Some(1), Some(2), 0).toOption.get
    import JdbcTransactionEngine.{Acquisition, acquisitionBudget}
    val cap = Acquisition(acquisitionBudget(8.seconds)).resetCap
    val refill = new CountDownLatch(1)
    val factory = new Counting(login = n => if (n > sizing.connections) { refill.await(10, TimeUnit.SECONDS); () })
    val trace = new Recorded; val executor = Executors.newSingleThreadExecutor()
    try Using.resources(plain(config), new JdbcTransactionEngine(config.copy(limits = limits), factory, sizing, JdbcTransactionEngine.scheduledWatchdog, () => System.nanoTime(), trace)) { (admin, pool) =>
      try {
        eventually("the fixed pool is open")(factory.opened.get == sizing.connections)
        val stale = factory.physical.asScala.toList
        val terminated = stale.map(pid)
        terminated.foreach(p => assertEquals(scalar(admin, s"SELECT pg_terminate_backend($p, 5000)"), "t"))
        assertEquals(backends(admin, s"pid IN (${terminated.mkString(",")})"), 0)
        val start = Deadline.now
        val tried = attempt(executor)(pool.transactionWithin(start + within)(pid))
        eventually("the stale connections are evicted")(stale.forall(_.isClosed))
        assert(Deadline.now - start < cap, s"evicted ${Deadline.now - start} after the start")
        assert(!tried.isDone)
        refill.countDown()
        val (outcome, _) = tried.get(30, TimeUnit.SECONDS)
        val served = outcome.get
        val index = factory.physical.asScala.toList.indexWhere(p => !p.isClosed && pid(p) == served) + 1
        assert(!terminated.contains(served) && index > sizing.connections, (served, index, terminated).toString)
        trace.floors()
      } finally refill.countDown()
    } finally executor.shutdownNow()
  } }

  test("M1 T4b-ii logins refused at once: one borrow spans the pool's back-off between the adder's failed logins and takes the first that succeeds") { configured { base =>
    val config = m1(base)
    val factory = new Counting(login = n => if (n <= 5) throw new java.sql.SQLException("refused", "08001"))
    val trace = new Recorded
    Using.resource(engine(config, 8.seconds, factory, trace = trace)) { pool =>
      pool.transactionWithin(Deadline.now + within)(pid)
      assertEquals((factory.logins.get, factory.opened.get, trace.borrows.size), (6, 1, 1))
      assert(factory.threads.asScala.forall(_.endsWith("connection-adder")), factory.threads.toString)
      trace.floors()
    }
  } }
}
