package ponygirls.runtime

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.lang.reflect.{InvocationTargetException, Proxy}
import java.net.{InetAddress, ServerSocket, Socket, URI}
import java.nio.file.Files
import java.sql.{Connection, DriverManager, SQLException, Statement}
import java.util.Properties
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import munit.FunSuite
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.*
import scala.util.Using

// Behavioral/Active: the wait's own loop on a virtual monotonic clock and sleeper; logins, refusals and the stalled or
// late probe on real PostgreSQL.
final class DatabaseWaitSuite extends FunSuite {
  private def withConfig[A](body: JdbcConfig => A): A = PostgresFixture.config.use(c => IO.blocking(body(c))).unsafeRunSync()
  /** Virtual time from 0: sleeps advance it, and each must end at or before the deadline. */
  private final class Time(bound: FiniteDuration) {
    @volatile var now = 0L
    val sleeps = ListBuffer.empty[FiniteDuration]
    val clock: () => Long = () => now
    val sleep: FiniteDuration => Unit = { pause =>
      assert(pause > Duration.Zero && pause.toNanos <= bound.toNanos - now, s"sleep $pause at ${now.nanos.toMillis} ms")
      sleeps += pause; now += pause.toNanos
    }
  }
  /** Each login's driver timeouts (login, connect, socket), then the scripted step for it (the last step repeats). */
  private final class Logins(steps: (String, Properties) => Connection*) extends JdbcConnectionFactory {
    val timeouts = ListBuffer.empty[(String, String, String)]
    def open(url: String, properties: Properties): Connection = {
      timeouts += ((properties.getProperty("loginTimeout"), properties.getProperty("connectTimeout"), properties.getProperty("socketTimeout")))
      steps(math.min(timeouts.size, steps.size) - 1)(url, properties)
    }
  }
  private def refused(sqlState: String): (String, Properties) => Connection = (_, _) => throw new SQLException("synthetic refusal", sqlState)
  private val real: (String, Properties) => Connection = DriverManager.getConnection(_, _)
  private def proxy[A](kind: Class[A], target: AnyRef)(intercept: PartialFunction[String, AnyRef]): A =
    Proxy.newProxyInstance(getClass.getClassLoader, Array(kind), (_, method, arguments) =>
      intercept.applyOrElse(method.getName, _ =>
        try method.invoke(target, Option(arguments).getOrElse(Array.empty[AnyRef])*) catch { case e: InvocationTargetException => throw e.getCause })
    ).asInstanceOf[A]
  private def timedOut(state: Option[String]) = JdbcFailure("database-wait-timeout", state)
  /** A real-time wait with a bound that is not whole seconds (the rounded socket timeout, 2 s, would end it late): it must
    * end with the timeout, no wait line and one login, at the bound and not later. */
  private def cutAtBound(config: JdbcConfig, logins: Logins): Unit = {
    val (bound, lines) = (1500.millis, ListBuffer.empty[String])
    val started = System.nanoTime()
    val failure = intercept[JdbcFailure](DatabaseWait.await(config, bound, lines += _, logins, DatabaseWait.systemNanos, DatabaseWait.threadSleep))
    val elapsed = (System.nanoTime() - started).nanos
    assertEquals((failure, lines.toList, logins.timeouts.size), (timedOut(None), Nil, 1))
    assert(elapsed >= bound && elapsed < bound + 300.millis, s"elapsed ${elapsed.toMillis} ms")
  }
  /** A TCP relay to the test database. Once `paced`, server bytes reach the client one per `pace`: an answer that keeps
    * making progress. */
  private final class Relay(database: URI, pace: FiniteDuration) extends AutoCloseable {
    @volatile var paced = false
    val pacedBytes = new AtomicInteger
    private val listener = new ServerSocket(0, 1, InetAddress.getLoopbackAddress)
    private val sockets = new ConcurrentLinkedQueue[Socket]
    val url: String = s"jdbc:postgresql://127.0.0.1:${listener.getLocalPort}${database.getPath}"
    private def daemon(body: => Unit): Unit = { Thread.ofPlatform().daemon().start(() => try body catch { case _: java.io.IOException => () }); () }
    daemon(while (true) {
      val client = listener.accept()
      val server = new Socket(database.getHost, database.getPort)
      sockets.add(client); sockets.add(server)
      daemon { client.getInputStream.transferTo(server.getOutputStream); () }
      daemon {
        val (in, out) = (server.getInputStream, client.getOutputStream)
        var next = in.read()
        while (next >= 0) {
          if (paced) { Thread.sleep(pace.toMillis); pacedBytes.incrementAndGet() }
          out.write(next)
          next = in.read()
        }
      }
    })
    def close(): Unit = { listener.close(); sockets.forEach(_.close()) }
  }

  test("production defaults; the smallest accepted bound starts at once against a healthy database") {
    assertEquals((DatabaseWait.defaultBound, DatabaseWait.interval, DatabaseWait.minimumAttempt), (120.seconds, 1.second, 100.millis))
    assertEquals(List(999L, 1000L, 3600000L, 3600001L).map(DatabaseWait.startWait), List(None, Some(1.second), Some(1.hour), None))
    withConfig { config =>
      val (time, logins, lines) = (Time(1.second), Logins(real), ListBuffer.empty[String])
      DatabaseWait.await(config, 1.second, lines += _, logins, time.clock, time.sleep)
      assertEquals((logins.timeouts.size, time.sleeps.toList, lines.toList), (1, Nil, Nil))
    }
  }

  test("57P03, 08001 and 53300 are waited out, then a real login whose SELECT 1 answers ends the wait") {
    withConfig { config =>
      val (time, lines) = (Time(DatabaseWait.defaultBound), ListBuffer.empty[String])
      val logins = Logins(refused("57P03"), refused("08001"), refused("53300"), real)
      DatabaseWait.await(config, DatabaseWait.defaultBound, lines += _, logins, time.clock, time.sleep)
      assertEquals(lines.toList, List("database-wait code=jdbc-57P03", "database-wait ready seconds=3"))
      assertEquals(time.sleeps.toList, List.fill(3)(1.second))
      // The configured connect (2 s) and socket (5 s) timeouts, under the remaining time.
      assertEquals(logins.timeouts.toList, List.fill(4)(("2.000", "2", "5")))
    }
  }

  test("a database that never accepts queries ends the wait exactly at the bound with its last SQLSTATE") {
    withConfig { config =>
      val (time, lines, logins) = (Time(DatabaseWait.defaultBound), ListBuffer.empty[String], Logins(refused("57P03")))
      assertEquals(intercept[JdbcFailure](DatabaseWait.await(config, DatabaseWait.defaultBound, lines += _, logins, time.clock, time.sleep)), timedOut(Some("57P03")))
      assertEquals((time.now, logins.timeouts.size, lines.toList), (DatabaseWait.defaultBound.toNanos, 120, List("database-wait code=jdbc-57P03")))
    }
  }

  test("near the bound: an attempt needs 100 ms, no driver timeout is 0, the probe needs 1 ms, the rest is slept away") {
    withConfig { config =>
      def run(bound: FiniteDuration, step: (String, Properties) => Connection, login: Time => Unit = _ => ()): (Time, Logins, JdbcFailure) = {
        val time = Time(bound)
        val logins = Logins((url, properties) => { login(time); step(url, properties) })
        (time, logins, intercept[JdbcFailure](DatabaseWait.await(config, bound, _ => (), logins, time.clock, time.sleep)))
      }
      val (time, logins, failure) = run(2150.millis, refused("08001"))
      assertEquals((failure, time.now), (timedOut(Some("08001")), 2150.millis.toNanos))
      assertEquals(logins.timeouts.toList, List(("2.000", "2", "3"), ("1.150", "2", "2"), ("0.150", "1", "1")))
      assertEquals(time.sleeps.toList, List(1.second, 1.second, 150.millis))
      val (late, lateLogins, lateFailure) = run(2050.millis, refused("08001"))
      assertEquals((lateFailure, late.now, lateLogins.timeouts.size), (timedOut(Some("08001")), 2050.millis.toNanos, 2))
      assertEquals(late.sleeps.toList, List(1.second, 1.second, 50.millis))
      // A login that ends at the deadline leaves no time for the probe: the connection is only closed.
      val calls = ListBuffer.empty[String]
      val connection = proxy(classOf[Connection], new Object)({ case name => calls += name; null })
      val (expired, _, expiredFailure) = run(1.second, (_, _) => connection, time => time.now = 1.second.toNanos)
      assertEquals((expiredFailure, expired.now, calls.toList), (timedOut(None), 1.second.toNanos, List("close")))
    }
  }

  test("a refused login or an unknown database ends the wait at once") {
    withConfig { config =>
      val wrong = Files.createTempFile("runtime-wrong-password-", ".txt")
      try {
        Files.writeString(wrong, "not-the-password\n")
        val absent = config.copy(jdbcUrl = config.jdbcUrl.take(config.jdbcUrl.lastIndexOf('/') + 1) + "runtime_absent")
        List(config.copy(passwordFile = wrong) -> "28P01", absent -> "3D000").foreach { (refusing, state) =>
          val (time, lines) = (Time(DatabaseWait.defaultBound), ListBuffer.empty[String])
          val failure = intercept[JdbcFailure](DatabaseWait.await(refusing, DatabaseWait.defaultBound, lines += _, Logins(real), time.clock, time.sleep))
          assertEquals((failure, time.sleeps.toList, lines.toList), (JdbcFailure("database-unavailable", Some(state)), Nil, Nil))
        }
      } finally Files.delete(wrong)
    }
  }

  test("a probe that stalls server-side after an authenticated login ends at the bound") {
    withConfig { config =>
      // The server ends the stalled backend once the client has gone (client_connection_check_interval).
      cutAtBound(config, Logins { (url, properties) =>
        val connection = DriverManager.getConnection(url, properties)
        Using.resource(connection.createStatement())(_.execute("SET client_connection_check_interval='100ms'"))
        proxy(classOf[Connection], connection)({ case "createStatement" =>
          val statement = connection.createStatement()
          proxy(classOf[Statement], statement)({ case "executeQuery" => statement.executeQuery("SELECT 1 FROM pg_sleep(30)") })
        })
      })
    }
  }

  test("a probe answer that keeps arriving, byte by byte, past the deadline ends at the bound") {
    withConfig { config =>
      Using.resource(Relay(URI.create(config.jdbcUrl.stripPrefix("jdbc:")), 100.millis)) { relay =>
        // Every read gets a byte within 100 ms: no socket timeout fires, the whole answer needs seconds.
        cutAtBound(config.copy(jdbcUrl = relay.url), Logins { (url, properties) =>
          val connection = DriverManager.getConnection(url, properties)
          relay.paced = true
          connection
        })
        assert(relay.pacedBytes.get > 1, "the answer made progress")
      }
    }
  }
}
