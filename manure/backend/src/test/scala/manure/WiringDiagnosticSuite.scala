package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.io.{ByteArrayOutputStream,PrintStream}
import java.nio.file.{Files,Path}
import ponygirls.auth.{AccountFailure,Password}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** Startup-failure classification contract. A misprovisioned credential file is a
  * config failure even though distage surfaces it as an izumi.* wrapper while
  * acquiring the DI graph (ProvisioningException keeps the actual failure only as
  * a suppressed exception). Regression for the deployment outage where SHA-256
  * hex password credentials (the token digest codec) were provisioned for the
  * PBKDF2 password-hash codec and the service reported `stage=wiring code=wiring`.
  */
final class WiringDiagnosticSuite extends munit.FunSuite:
  /** A failed start exits within seconds; the bound only stops a hung child. */
  private val childExitBound = 50L
  /** A cancelled start unwinds within seconds; the bound stays below the suite's 30 s test timeout. */
  private val terminationBound = 20L
  /** The child JVM must not inherit the JVM option variables of the test environment (the Nix check sets JAVA_TOOL_OPTIONS),
    * whose "Picked up …" notice would be a stderr line that is not the service's; the complete stderr stays asserted. */
  private def childEnvironment(builder: ProcessBuilder): ProcessBuilder = {
    Vector("JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS").foreach(builder.environment().remove)
    builder
  }
  /** The known notices a fresh JVM prints on stderr that are not the service's, matched exactly: the JDK's warnings about
    * the native library load (a block ending in an empty line) and Scala's LazyVals, SLF4J's no-binding notice and
    * cats-effect's CPU-starvation warning on a loaded host. */
  private val knownJvmNotices = Vector(
    """WARNING: A restricted method in java\.lang\.System has been called""",
    """WARNING: java\.lang\.System::load has been called by manure\.storage\.PosixNative in an unnamed module \(file:[^)]+\)""",
    """WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module""",
    """WARNING: Restricted methods will be blocked in a future release unless native access is enabled""",
    "",
    """WARNING: A terminally deprecated method in sun\.misc\.Unsafe has been called""",
    """WARNING: sun\.misc\.Unsafe::objectFieldOffset has been called by scala\.runtime\.LazyVals\$ \(file:[^)]+\)""",
    """WARNING: Please consider reporting this to the maintainers of class scala\.runtime\.LazyVals\$""",
    """WARNING: sun\.misc\.Unsafe::objectFieldOffset will be removed in a future release""",
    """SLF4J: Failed to load class "org\.slf4j\.impl\.StaticLoggerBinder"\.""",
    """SLF4J: Defaulting to no-operation \(NOP\) logger implementation""",
    """SLF4J: See http://www\.slf4j\.org/codes\.html#StaticLoggerBinder for further details\.""",
    """.+ \[WARNING\] Your app's responsiveness to a new asynchronous event \(such as a new connection, an upstream response, or a timer\) was in excess of .+\. Your CPU is probably starving\. .+""")
  private def cleanup(path: Path): Unit =
    val _ = try
      Using.resource(Files.walk(path))(_.iterator().asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)))
    catch case _: Exception => ()
  /** Runs one command in process; its exit code and complete stderr, and that it printed nothing on stdout. */
  private def runCommand(command: String,config: String): (Int,String) =
    val captured = new ByteArrayOutputStream(); val output = new ByteArrayOutputStream()
    val (original,originalOut) = (System.err,System.out)
    val exit = try
      System.setErr(new PrintStream(captured,true,java.nio.charset.StandardCharsets.UTF_8))
      System.setOut(new PrintStream(output,true,java.nio.charset.StandardCharsets.UTF_8))
      Main.run(List(command,config)).unsafeRunSync()
    finally
      System.setErr(original); System.setOut(originalOut)
    assertEquals(output.toString(java.nio.charset.StandardCharsets.UTF_8),"",command)
    (exit.code,captured.toString(java.nio.charset.StandardCharsets.UTF_8))
  /** Runs `manure.Main` as deployed (IOApp's own runtime and failure reporter) in a child JVM: exit code, the stderr
    * lines other than knownJvmNotices, and stdout. */
  private def child(root: Path,arguments: String*): (Int,List[String],String) = signalled(root,_ => (),arguments*)
  /** As [[child]], acting on the running process (`whileRunning`) before it waits for its exit. */
  private def signalled(root: Path,whileRunning: Process => Unit,arguments: String*): (Int,List[String],String) =
    val (err,out) = (root.resolve("child.err"),root.resolve("child.out"))
    val classpath = sys.props.getOrElse("manure.test.childClasspath",throw new IllegalArgumentException("explicit manure.test.childClasspath required"))
    val process = childEnvironment(new ProcessBuilder((Vector(Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",classpath,"manure.Main") ++ arguments)*))
      .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null"))).redirectError(err.toFile).redirectOutput(out.toFile).start()
    try
      whileRunning(process)
      assert(process.waitFor(childExitBound,java.util.concurrent.TimeUnit.SECONDS),"the child did not exit")
    finally
      process.destroyForcibly(); process.waitFor()
    (process.exitValue,Files.readString(err).linesIterator.filterNot(line => knownJvmNotices.exists(line.matches)).toList,Files.readString(out))
  /** Deployment-shaped config: a human with login/passwordHashFile plus a token
    * and a token-only agent, never a live database. */
  private def deploymentConfig(root: Path,passwordHash: String,settings: Json): Path =
    val data = Files.createDirectory(root.resolve("data"))
    val token = root.resolve("token.hash"); Files.writeString(token,SecretCodec.sha256("token-secret")+"\n")
    val other = root.resolve("other.hash"); Files.writeString(other,SecretCodec.sha256("other-secret")+"\n")
    val password = root.resolve("password.hash"); Files.writeString(password,passwordHash)
    val database = root.resolve("dbpass"); Files.writeString(database,"dummy\n")
    val config = root.resolve("config.json")
    Files.writeString(config,Json.obj(
      "data_dir" -> Json.fromString(data.toString),"api_origin" -> Json.fromString("http://127.0.0.1:47329"),
      "listen_address" -> Json.fromString("127.0.0.1"),"port" -> Json.fromInt(47329),"content_mode" -> Json.fromString("path"),
      "loopback_dev" -> Json.True,"native_mode" -> Json.fromString("shared"),
      "posix_library" -> Json.fromString(sys.env("MANURE_POSIX_LIBRARY")),
      "users" -> Json.arr(
        Json.obj("id" -> Json.fromString("pavel"),"type" -> Json.fromString("human"),"login" -> Json.fromString("pavel"),
          "passwordHashFile" -> Json.fromString(password.toString),
          "tokens" -> Json.arr(Json.obj("id" -> Json.fromString("default"),"hashFile" -> Json.fromString(token.toString)))),
        Json.obj("id" -> Json.fromString("kai"),"type" -> Json.fromString("human"),"login" -> Json.fromString("kai"),
          "passwordHashFile" -> Json.fromString(password.toString),"tokens" -> Json.arr()),
        Json.obj("id" -> Json.fromString("llm"),"type" -> Json.fromString("agent"),
          "tokens" -> Json.arr(Json.obj("id" -> Json.fromString("default"),"hashFile" -> Json.fromString(other.toString))))),
      "database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/not-live"),"user" -> Json.fromString("manure"),
        "passwordFile" -> Json.fromString(database.toString),
        "limits" -> Json.obj("maxConnections" -> Json.fromInt(4),"maxQueued" -> Json.fromInt(16),"queueTimeoutMs" -> Json.fromInt(5000),
          "connectTimeoutMs" -> Json.fromInt(5000),"statementTimeoutMs" -> Json.fromInt(30000),"lockTimeoutMs" -> Json.fromInt(5000),
          "idleTransactionTimeoutMs" -> Json.fromInt(30000),"socketTimeoutMs" -> Json.fromInt(30000)))).deepMerge(settings).noSpaces)
    config
  /** A TCP relay to the fixture database that withholds every server byte once the client has sent the readiness probe
    * (`SELECT 1`): an authenticated login whose probe stalls. `probed` opens when the probe has been sent. */
  private final class StallingRelay(database: java.net.URI) extends AutoCloseable:
    val probed = new java.util.concurrent.CountDownLatch(1)
    private val listener = new java.net.ServerSocket(0,1,java.net.InetAddress.getLoopbackAddress)
    private val sockets = new java.util.concurrent.ConcurrentLinkedQueue[java.net.Socket]()
    val url: String = s"jdbc:postgresql://127.0.0.1:${listener.getLocalPort}${database.getPath}"
    private def daemon(body: => Unit): Unit =
      val _ = Thread.ofPlatform().daemon().start(() => try body catch case _: java.io.IOException => ())
    private def pump(from: java.net.Socket,to: java.net.Socket,request: Boolean): Unit =
      val buffer = new Array[Byte](8192)
      var read = from.getInputStream.read(buffer)
      while read >= 0 do
        if request && new String(buffer,0,read,java.nio.charset.StandardCharsets.ISO_8859_1).contains("SELECT 1") then probed.countDown()
        if request || probed.getCount > 0 then to.getOutputStream.write(buffer,0,read)
        read = from.getInputStream.read(buffer)
    daemon {
      while true do
        val client = listener.accept()
        val server = new java.net.Socket(database.getHost,database.getPort)
        sockets.add(client); sockets.add(server)
        daemon(pump(client,server,true)); daemon(pump(server,client,false))
    }
    def close(): Unit = (listener +: sockets.asScala.toVector).foreach(_.close())
  /** The fixture's database and runtime role in place of the unreachable one: the start waits for the database before wiring. */
  private def reachable(database: ponygirls.runtime.JdbcConfig): Json = Json.obj("database" -> Json.obj("jdbcUrl" -> Json.fromString(database.jdbcUrl),
    "user" -> Json.fromString(database.user),"passwordFile" -> Json.fromString(database.passwordFile.toString)))

  test("sha256-hex password credential fails as config, never as a wiring failure") {
    BackendFixture.configuration.use { (fixture,_,_) => IO.blocking {
      val root = Files.createTempDirectory("manure-wiring-diagnostic-")
      try
        // The token digest codec (64 hex chars) is NOT the password hash codec.
        val config = deploymentConfig(root,SecretCodec.sha256("deployment-password")+"\n",reachable(fixture.database))
        assertEquals(runCommand("migrate",config.toString),(1,"manure failure stage=wiring code=config error=AccountFailure message=\"config\"\n"))
      finally cleanup(root)
    }}.unsafeRunSync()
  }

  test("valid pbkdf2 password credentials acquire the wiring graph") {
    BackendFixture.configuration.use { (fixture,_,_) => IO.blocking {
      val root = Files.createTempDirectory("manure-wiring-diagnostic-")
      try
        val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",reachable(fixture.database))
        assertEquals(runCommand("migrate",config.toString),(0,""))
      finally cleanup(root)
    }}.unsafeRunSync()
  }

  test("an unreachable database is waited for until startWaitMs, then fails the database-wait stage; a missing credential fails it at once") {
    val root = Files.createTempDirectory("manure-wiring-diagnostic-")
    try
      val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",
        Json.obj("database" -> Json.obj("limits" -> Json.obj("startWaitMs" -> Json.fromInt(1000)))))
      val started = System.nanoTime()
      assertEquals(runCommand("migrate",config.toString),
        (1,"manure database-wait code=jdbc-08001\nmanure failure stage=database-wait code=jdbc-08001 error=JdbcFailure message=\"database-wait-timeout\"\n"))
      assert((System.nanoTime() - started).nanos >= 1.second)
      Files.delete(root.resolve("dbpass"))
      assertEquals(runCommand("migrate",config.toString),(1,"manure failure stage=database-wait code=credential-file error=RuntimeFailure message=\"credential-file\"\n"))
      Files.writeString(config,Files.readString(config).replace("\"startWaitMs\":1000","\"startWaitMs\":999"))
      assertEquals(runCommand("check-config",config.toString),(1,"manure failure stage=config code=bad-envelope error=DomainError message=\"bad-envelope\"\n"))
    finally cleanup(root)
  }

  test("SIGTERM ends a start whose readiness probe stalls after an authenticated login") {
    BackendFixture.configuration.use { (fixture,_,_) => IO.blocking {
      val root = Files.createTempDirectory("manure-wiring-diagnostic-")
      try Using.resource(StallingRelay(java.net.URI.create(fixture.database.jdbcUrl.stripPrefix("jdbc:")))) { relay =>
        // A wait budget far beyond the child's exit bound: only the cancellation can end the probe in time.
        val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",reachable(fixture.database).deepMerge(Json.obj(
          "database" -> Json.obj("jdbcUrl" -> Json.fromString(relay.url),"limits" -> Json.obj("startWaitMs" -> Json.fromInt(600000))))))
        val terminated = signalled(root,{ process =>
          assert(relay.probed.await(childExitBound,java.util.concurrent.TimeUnit.SECONDS),"the child sent no probe")
          process.destroy()
          assert(process.waitFor(terminationBound,java.util.concurrent.TimeUnit.SECONDS),"SIGTERM did not end the start")
        },"migrate",config.toString)
        assertEquals(terminated,(143,Nil,""))
      }
      finally cleanup(root)
    }}.unsafeRunSync()
  }

  test("serve refuses a configured asset directory that does not exist at startup, before it touches the database") {
    Vector("dashboard_dir" -> "dashboard-dir-missing","unlock_shell_dir" -> "unlock-shell-dir-missing","viewer_dir" -> "viewer-dir-missing").foreach { (setting,code) =>
      val root = Files.createTempDirectory("manure-wiring-diagnostic-")
      try
        val disabled = Json.obj("dashboard_dir" -> Json.Null,"unlock_shell_dir" -> Json.Null,"viewer_dir" -> Json.Null)
        val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",
          disabled.deepMerge(Json.obj(setting -> Json.fromString(root.resolve("absent-assets").toString))))
        assertEquals(runCommand("serve",config.toString),(1,s"manure failure stage=assets code=$code error=DomainError message=\"$code\"\n"),setting)
      finally cleanup(root)
    }
  }

  test("an unusable config path fails the config stage instead of escaping the handler") {
    assertEquals(runCommand("serve","config\u0000.json"),(1,"manure failure stage=config code=configuration error=InvalidPathException message=\"invalid configuration\"\n"))
  }

  test("serve on an occupied listen port fails the bind stage with address in use and the port") {
    BackendFixture.configuration.use { (fixture,_,_) => IO.blocking {
      val root = Files.createTempDirectory("manure-wiring-diagnostic-")
      try Using.resource(new java.net.ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))) { occupied =>
        val port = occupied.getLocalPort
        val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",Json.obj(
          "port" -> Json.fromInt(port),"api_origin" -> Json.fromString(s"http://127.0.0.1:$port"),
          "dashboard_dir" -> Json.Null,"unlock_shell_dir" -> Json.Null,"viewer_dir" -> Json.Null,
          // The smallest start wait passes a healthy database without a wait line.
          "database" -> Json.obj("limits" -> Json.obj("startWaitMs" -> Json.fromInt(1000)))).deepMerge(reachable(fixture.database)))
        assertEquals(child(root,"serve",config.toString),(1,List(s"manure failure stage=bind code=address-in-use error=BindException message=\"address in use\" port=$port"),""))
      }
      finally cleanup(root)
    }}.unsafeRunSync()
  }

  test("password readHash rejects token digests and accepts the pbkdf2 encoding") {
    val root = Files.createTempDirectory("manure-wiring-diagnostic-")
    try
      val digest = root.resolve("digest.hash"); Files.writeString(digest,SecretCodec.sha256("deployment-password")+"\n")
      assertEquals(intercept[AccountFailure](Password.readHash(digest)).code,"config")
      val encoded = root.resolve("password.hash")
      val content = Password.hash("fixture-password".toCharArray); Files.writeString(encoded,content+"\n")
      assertEquals(Password.readHash(encoded),content)
    finally cleanup(root)
  }
