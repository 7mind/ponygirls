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
  private def cleanup(path: Path): Unit =
    val _ = try
      Using.resource(Files.walk(path))(_.iterator().asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)))
    catch case _: Exception => ()
  private def runCommand(command: String,config: Path): (Int,String) =
    val captured = new ByteArrayOutputStream()
    val original = System.err
    val exit = try
      System.setErr(new PrintStream(captured,true,java.nio.charset.StandardCharsets.UTF_8))
      Main.run(List(command,config.toString)).unsafeRunSync()
    finally System.setErr(original)
    (exit.code,captured.toString(java.nio.charset.StandardCharsets.UTF_8))
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
      val (exit,stderr) = runCommand("migrate",config)
      assertEquals(exit,1)
      val lines = stderr.linesIterator.filter(_.startsWith("manure ")).toList
      assertEquals(lines,List("""manure failure stage=wiring code=config error=AccountFailure message="config""""))
    finally cleanup(root)
  }

  test("valid pbkdf2 password credentials acquire the wiring graph") {
    val root = Files.createTempDirectory("manure-wiring-diagnostic-")
    try
      val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",Json.obj())
      val (exit,stderr) = runCommand("migrate",config)
      assertEquals(exit,1)
      val lines = stderr.linesIterator.filter(_.startsWith("manure ")).toList
      // Wiring succeeds; startup proceeds to the schema stage and fails only on
      // the deliberately unreachable database.
      assert(!lines.exists(_.contains("stage=wiring")),stderr)
      assert(lines.exists(_.startsWith("manure failure stage=start code=jdbc-")),stderr)
    finally cleanup(root)
  }

  test("serve refuses a configured asset directory that does not exist at startup, before it touches the database") {
    Vector("dashboard_dir" -> "dashboard-dir-missing","unlock_shell_dir" -> "unlock-shell-dir-missing","viewer_dir" -> "viewer-dir-missing").foreach { (setting,code) =>
      val root = Files.createTempDirectory("manure-wiring-diagnostic-")
      try
        val disabled = Json.obj("dashboard_dir" -> Json.Null,"unlock_shell_dir" -> Json.Null,"viewer_dir" -> Json.Null)
        val config = deploymentConfig(root,Password.hash("fixture-password".toCharArray)+"\n",
          disabled.deepMerge(Json.obj(setting -> Json.fromString(root.resolve("absent-assets").toString))))
        val (exit,stderr) = runCommand("serve",config)
        assertEquals(exit,1,setting)
        assertEquals(stderr.linesIterator.filter(_.startsWith("manure ")).toList,List(s"""manure failure stage=assets code=$code error=DomainError message="$code""""),setting)
      finally cleanup(root)
    }
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
        val (exit,stderr) = runCommand("serve",config)
        assertEquals(exit,1)
        assertEquals(stderr.linesIterator.filter(_.startsWith("manure ")).toList,
          List(s"""manure failure stage=bind code=address-in-use error=BindException message="address in use" port=$port"""))
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
