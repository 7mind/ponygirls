package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.io.{ByteArrayOutputStream,PrintStream}
import java.nio.file.{Files,Path}
import ponygirls.auth.{AccountFailure,Password}
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
  /** Lines a fresh JVM prints on stderr that are not the service's: the JDK's own warnings (a block ending in an empty line), SLF4J's no-binding notice and
    * cats-effect's CPU-starvation warning on a loaded host. */
  private val unrelatedJvmLines = Vector("WARNING: ","SLF4J: ","SLF4J(","[WARNING] Your app's responsiveness")
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
    * lines other than unrelatedJvmLines, and stdout. */
  private def child(root: Path,arguments: String*): (Int,List[String],String) =
    val (err,out) = (root.resolve("child.err"),root.resolve("child.out"))
    val classpath = sys.props.getOrElse("manure.test.childClasspath",throw new IllegalArgumentException("explicit manure.test.childClasspath required"))
    val process = new ProcessBuilder((Vector(Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",classpath,"manure.Main") ++ arguments)*)
      .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null"))).redirectError(err.toFile).redirectOutput(out.toFile).start()
    try assert(process.waitFor(childExitBound,java.util.concurrent.TimeUnit.SECONDS),"the child did not exit")
    finally
      process.destroyForcibly(); process.waitFor()
    (process.exitValue,Files.readString(err).linesIterator.filterNot(line => line.isEmpty || unrelatedJvmLines.exists(line.startsWith)).toList,Files.readString(out))
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

  test("sha256-hex password credential fails as config, never as a wiring failure") {
    val root = Files.createTempDirectory("manure-wiring-diagnostic-")
    try
      // The token digest codec (64 hex chars) is NOT the password hash codec.
      val config = deploymentConfig(root,SecretCodec.sha256("deployment-password")+"\n",Json.obj())
      assertEquals(runCommand("migrate",config.toString),(1,"manure failure stage=wiring code=config error=AccountFailure message=\"config\"\n"))
    finally cleanup(root)
  }

  test("valid pbkdf2 password credentials acquire the wiring graph") {
    val root = Files.createTempDirectory("manure-wiring-diagnostic-")
    try
      val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",Json.obj())
      // Wiring succeeds; startup proceeds to the first database use and fails only on
      // the deliberately unreachable database.
      assertEquals(runCommand("migrate",config.toString),(1,"manure failure stage=database code=jdbc-08001 error=JdbcFailure message=\"database-unavailable\"\n"))
    finally cleanup(root)
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
          "database" -> Json.obj("jdbcUrl" -> Json.fromString(fixture.database.jdbcUrl),"user" -> Json.fromString(fixture.database.user),
            "passwordFile" -> Json.fromString(fixture.database.passwordFile.toString))))
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
