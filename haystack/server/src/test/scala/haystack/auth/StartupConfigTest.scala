package haystack.auth

import cats.effect.ExitCode
import cats.effect.unsafe.implicits.global
import haystack.{Config, Main}
import haystack.storage.TestSupport
import io.circe.Json
import java.io.{ByteArrayOutputStream, PrintStream}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.sql.DriverManager
import ponygirls.runtime.CredentialFile
import scala.concurrent.duration.*
import scala.util.Using

/** BA/BG + owned filesystem: characterize the actual configuration/startup
  * rejection path. Subprocess/SIGTERM is transport-owned.
  */
class StartupConfigTest extends munit.FunSuite {
  override val munitTimeout = 30.seconds
  /** A failed start exits within seconds; the bound only stops a hung child. */
  private val ChildExitBound = 25.seconds
  /** Lines a fresh JVM prints on stderr that are not the service's: the JDK's own warnings (a block ending in an empty line), SLF4J's no-binding notice and
    * cats-effect's CPU-starvation warning on a loaded host. */
  private val UnrelatedJvmLines = Vector("WARNING: ", "SLF4J: ", "SLF4J(", "[WARNING] Your app's responsiveness")
  import AuthFixtures.*
  private def valid(dir: Path): Json = {
    val auth = config(dir)
    Json.obj(
      "listenHost" -> Json.fromString("127.0.0.1"), "listenPort" -> Json.fromInt(8765), "webRoot" -> Json.Null, "authReloadMs" -> Json.fromInt(1000),
      "auth" -> Json.obj(
        "activityProjectId" -> Json.fromString(auth.activityProjectId), "users" -> Json.arr(auth.users.map { user => Json.obj(
          "id" -> Json.fromString(user.id), "type" -> Json.fromString(user.userType), "displayName" -> Json.fromString(user.displayName),
          "tokens" -> Json.arr(user.tokens.map(token => Json.obj("id" -> Json.fromString(token.id), "hashFile" -> Json.fromString(token.hashFile)))*)) }*),
        "cookieSecure" -> Json.True, "allowedHosts" -> Json.arr(Json.fromString("nb.test"), Json.fromString("ts.test")),
        "allowedOrigins" -> Json.arr(Json.fromString(Plain), Json.fromString(Secure)), "insecureHttpOrigins" -> Json.arr(Json.fromString(Plain)), "rateLimit" -> Json.Null),
      // Deliberately unreachable: valid check-config must never contact a DB;
      // invalid auth must fail before serve/migrate acquires DB resources.
      "database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/haystack_synthetic_test"), "user" -> Json.fromString("synthetic"),
        "passwordFile" -> Json.fromString(write(dir, "database.password", "synthetic-not-a-secret")), "limits" -> Json.obj(
          "maxConnections" -> Json.fromInt(4), "maxQueued" -> Json.fromInt(4), "queueTimeoutMs" -> Json.fromInt(1000), "connectTimeoutMs" -> Json.fromInt(1000),
          "statementTimeoutMs" -> Json.fromInt(3000), "lockTimeoutMs" -> Json.fromInt(1000), "idleTransactionTimeoutMs" -> Json.fromInt(3000), "socketTimeoutMs" -> Json.fromInt(5000))),
      "retrieval" -> Json.obj("policy" -> Json.fromString("synthetic-approved"), "includeMetadata" -> Json.True, "approvedFieldPrefixes" -> Json.arr(Json.fromString("/public")),
        "maxChunkBytes" -> Json.fromInt(4096), "embedding" -> Json.Null, "maxConcurrent" -> Json.fromInt(2), "maxQueued" -> Json.fromInt(2), "batchSize" -> Json.fromInt(16)))
  }
  private def set(json: Json, path: String, value: Json): Json = {
    def update(current: Json, parts: List[String]): Json = parts match {
      case key :: Nil => current.mapObject(_.add(key, value))
      case key :: rest => current.mapObject(obj => obj.add(key, update(obj(key).get, rest)))
      case Nil => value
    }
    update(json, path.split('/').toList)
  }
  private def file(dir: Path, json: Json): Path = {
    val path = dir.resolve("service.json"); Files.writeString(path, json.noSpaces); path
  }
  /** Runs one command in process; keeps its exit code, its complete stderr and its complete stdout. */
  private def captured(command: String, path: String): (ExitCode, String, String) = {
    val err = new ByteArrayOutputStream(); val out = new ByteArrayOutputStream(); val (originalErr, originalOut) = (System.err, System.out)
    val exit = try {
      System.setErr(new PrintStream(err, true, UTF_8)); System.setOut(new PrintStream(out, true, UTF_8))
      Main.run(List(command, path)).unsafeRunSync()
    } finally { System.setErr(originalErr); System.setOut(originalOut) }
    (exit, err.toString(UTF_8), out.toString(UTF_8))
  }
  /** Runs `haystack.Main` as deployed (IOApp's own runtime and failure reporter) in a child JVM: exit code, the stderr
    * lines other than [[UnrelatedJvmLines]], and stdout. */
  private def child(dir: Path, arguments: String*): (Int, List[String], String) = {
    val (err, out) = (dir.resolve("child.err"), dir.resolve("child.out"))
    val launcher = Path.of(System.getProperty("java.home"), "bin", "java").toString
    val classpath = classOf[Main.type].getClassLoader match {
      case loader: java.net.URLClassLoader => loader.getURLs.map(url => Path.of(url.toURI).toString).mkString(java.io.File.pathSeparator)
      case other => fail("the child needs the URL class loader of sbt's forked test JVM, got " + other)
    }
    val process = new ProcessBuilder((Vector(launcher, "-cp", classpath, "haystack.Main") ++ arguments)*)
      .redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null"))).redirectError(err.toFile).redirectOutput(out.toFile).start()
    try assert(process.waitFor(ChildExitBound.toSeconds, java.util.concurrent.TimeUnit.SECONDS), "the child did not exit")
    finally { process.destroyForcibly(); process.waitFor() }
    (process.exitValue, Files.readString(err).linesIterator.filterNot(line => line.isEmpty || UnrelatedJvmLines.exists(line.startsWith)).toList, Files.readString(out))
  }
  /** A disposable database on the owned test cluster, dropped afterwards. */
  private def freshDatabase[A](body: String => A): A = {
    val config = TestSupport.databaseConfig
    val name = "haystack_start_" + java.util.UUID.randomUUID().toString.replace("-", "")
    def admin(sql: String): Unit = Using.resource(DriverManager.getConnection(config.jdbcUrl, config.user, CredentialFile.read(config.passwordFile))) { c =>
      Using.resource(c.createStatement())(_.execute(sql)); ()
    }
    admin("CREATE DATABASE " + name)
    try body(config.jdbcUrl.take(config.jdbcUrl.lastIndexOf('/') + 1) + name) finally admin("DROP DATABASE " + name + " WITH (FORCE)")
  }
  test("complete current config loads exactly and check-config validates auth without DB access") { directory { dir =>
    val path = file(dir, valid(dir)); val loaded = Config.load(path)
    assertEquals(loaded.listenHost, "127.0.0.1"); assertEquals(loaded.listenPort, 8765)
    assertEquals(loaded.authReloadMs, 1000); assertEquals(loaded.auth.users.map(_.userType), Vector("human", "agent"))
    assertEquals(loaded.retrieval.embedding, None); assertEquals(loaded.retrieval.policy.approvedFieldPrefixes, Vector("/public"))
    assertEquals(Auth.load(loaded.auth).authenticate(AliceToken).map(_.userId), Some("alice"))
    assertEquals(Main.run(List("check-config", path.toString)).unsafeRunSync(), ExitCode.Success)
  } }
  test("optional password-only human fields load without changing legacy omitted defaults") { directory { dir=>
    val base=valid(dir)
    val users=base.hcursor.downField("auth").get[Vector[Json]]("users").toOption.get
    val hash=write(dir,"human.password",ponygirls.auth.Password.hash(AlicePassword.toCharArray))
    val human=users.head.mapObject(_.add("login",Json.fromString("alice")).add("passwordHashFile",Json.fromString(hash)).add("enabled",Json.False).add("tokens",Json.arr()))
    val path=file(dir,set(base,"auth/users",Json.arr(human,users(1))))
    val loaded=Config.load(path)
    assertEquals(loaded.auth.users.head.login,Some("alice"));assertEquals(loaded.auth.users.head.passwordHashFile,Some(hash))
    assert(!loaded.auth.users.head.enabled);assert(loaded.auth.users(1).enabled)
    assertEquals(Auth.load(loaded.auth).users.head.enabled,false)
    assertEquals(Main.run(List("check-config",path.toString)).unsafeRunSync(),ExitCode.Success)
    Vector("enabled"->Json.Null,"enabled"->Json.fromString("true"),"login"->Json.Null,"passwordHashFile"->Json.fromInt(1)).foreach { case(key,value)=>
      val invalid=human.mapObject(_.add(key,value))
      intercept[Exception](Config.load(file(dir,set(base,"auth/users",Json.arr(invalid,users(1))))))
    }
  }}
  Vector(
    "listenPort" -> Json.fromInt(0), "listenPort" -> Json.fromInt(65536), "listenHost" -> Json.fromString(""), "authReloadMs" -> Json.fromInt(99),
    "authReloadMs" -> Json.fromInt(60001), "database/jdbcUrl" -> Json.fromString("jdbc:postgresql://secret:password@localhost/test"),
    "database/jdbcUrl" -> Json.fromString("jdbc:postgresql://localhost/test?password=secret"), "database/passwordFile" -> Json.fromString("relative-secret"),
    "database/limits/maxConnections" -> Json.fromInt(0), "database/limits/maxQueued" -> Json.fromInt(-1),
    "database/limits/queueTimeoutMs" -> Json.fromInt(0), "database/limits/socketTimeoutMs" -> Json.fromInt(3600001),
    "retrieval/approvedFieldPrefixes" -> Json.arr(Json.fromString("not-a-pointer")), "retrieval/approvedFieldPrefixes" -> Json.arr(Json.fromString("/bad~2")),
    "retrieval/approvedFieldPrefixes" -> Json.arr(Json.fromString("/a"), Json.fromString("/a")), "retrieval/maxChunkBytes" -> Json.fromInt(3),
    "retrieval/maxConcurrent" -> Json.fromInt(0), "retrieval/maxConcurrent" -> Json.fromInt(33), "retrieval/maxQueued" -> Json.fromInt(1025),
    "retrieval/batchSize" -> Json.fromInt(0), "retrieval/batchSize" -> Json.fromInt(1025), "listenPort" -> Json.fromString("8765")
  ).zipWithIndex.foreach { case ((path, value), i) =>
    test(s"invalid current configuration $i fails startup, not fallback/default coercion") { directory { dir =>
      val pathToConfig = file(dir, set(valid(dir), path, value))
      intercept[Exception](Config.load(pathToConfig))
      assertEquals(Main.run(List("check-config", pathToConfig.toString)).unsafeRunSync(), ExitCode.Error)
    } }
  }
  Vector("empty-users", "duplicate-users", "unknown-user-type", "missing-hash-file", "malformed-hash", "wrong-namespace", "wrong-insecure-origin").foreach { kind =>
    test("Main rejects startup auth: " + kind) { directory { dir =>
      val base = valid(dir)
      val users = base.hcursor.downField("auth").get[Vector[Json]]("users").toOption.get
      val json = kind match {
        case "empty-users" => set(base, "auth/users", Json.arr())
        case "duplicate-users" => set(base, "auth/users", Json.arr((users :+ users.head)*))
        case "unknown-user-type" => set(base, "auth/users", Json.arr(users.head.mapObject(_.add("type", Json.fromString("robot")))))
        case "missing-hash-file" =>
          Files.delete(dir.resolve("alice.sha")); base
        case "malformed-hash" =>
          Files.writeString(dir.resolve("alice.sha"), "INVALID-SYNTHETIC-DIGEST"); base
        case "wrong-namespace" => set(base, "auth/activityProjectId", Json.fromString(""))
        case _ => set(base, "auth/insecureHttpOrigins", Json.arr(Json.fromString("http://other.test:8085")))
      }
      val path = file(dir, json)
      Vector("check-config", "migrate", "serve").foreach { command =>
        assertEquals(Main.run(List(command, path.toString)).unsafeRunSync(), ExitCode.Error)
      }
    } }
  }
  test("an unreachable database fails the migrate stage with its SQLSTATE and without the URL") { directory { dir =>
    assertEquals(captured("migrate", file(dir, valid(dir)).toString),
      (ExitCode.Error, "haystack failure stage=migrate code=jdbc-08001 error=JdbcFailure message=\"database-unavailable\"\n", ""))
  } }
  test("an unusable config path or listen host fails the config stage before anything starts") { directory { dir =>
    assertEquals(captured("serve", "config\u0000.json"),
      (ExitCode.Error, "haystack failure stage=config code=internal error=InvalidPathException message=\"unexpected failure\"\n", ""))
    assertEquals(captured("check-config", file(dir, set(valid(dir), "listenHost", Json.fromString("not a host"))).toString),
      (ExitCode.Error, "haystack failure stage=config code=config error=Fault message=\"invalid listen host\"\n", ""))
  } }
  test("serve on an occupied listen port fails the bind stage with address in use and the port") { directory { dir => freshDatabase { url =>
    Using.resource(new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) { occupied =>
      val port = occupied.getLocalPort
      val database = TestSupport.databaseConfig
      val json = Vector("listenPort" -> Json.fromInt(port), "database/jdbcUrl" -> Json.fromString(url), "database/user" -> Json.fromString(database.user),
        "database/passwordFile" -> Json.fromString(database.passwordFile.toString)).foldLeft(valid(dir)) { case (json, (path, value)) => set(json, path, value) }
      assertEquals(child(dir, "serve", file(dir, json).toString),
        (1, List(s"haystack failure stage=bind code=address-in-use error=BindException message=\"address in use\" port=$port"), ""))
    }
  } } }
  test("missing, malformed and duplicate-key config inputs fail closed") { directory { dir =>
    assertEquals(Main.run(List("check-config", dir.resolve("missing.json").toString)).unsafeRunSync(), ExitCode.Error)
    Vector("{", "{\"listenPort\":1,\"listenPort\":2}", "{\"x\":\"\\uD800\"}").zipWithIndex.foreach { case (raw, i) =>
      val path = dir.resolve(s"bad$i.json"); Files.writeString(path, raw)
      assertEquals(Main.run(List("check-config", path.toString)).unsafeRunSync(), ExitCode.Error)
    }
    assertEquals(Main.run(List("unknown-command", "ignored")).unsafeRunSync(), ExitCode.Error)
  } }
}
