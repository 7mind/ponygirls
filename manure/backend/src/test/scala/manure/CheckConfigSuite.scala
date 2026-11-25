package manure

import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.nio.file.{Files,Path}
import java.util.concurrent.TimeUnit
import ponygirls.auth.IndexingPolicy
import scala.util.Using
import munit.FunSuite

object CheckConfigProbe:
  def main(args: Array[String]): Unit = sys.exit(Main.run(args.toList).unsafeRunSync().code)

/** Actual CLI, isolated child, owned no-writer FIFOs/nonexistent references and
  * unreachable loopback model/JDBC endpoints. Configuration validation must not
  * open any referenced secret, payload root, native library, model or database.
  */
final class CheckConfigSuite extends FunSuite:
  private val maximumChildOutputBytes = 16 * 1024

  test("check-config validates current config without referenced credential or external IO") {
    val directory=Files.createTempDirectory("manure-check-config-")
    val fifo=directory.resolve("credential-fifo")
    val mkfifo=new ProcessBuilder("mkfifo",fifo.toString).start()
    try
      assert(mkfifo.waitFor(5,TimeUnit.SECONDS));assertEquals(mkfifo.exitValue(),0)
      val limits=Json.obj("maxConnections" -> Json.fromInt(1),"maxQueued" -> Json.fromInt(1),
        "queueTimeoutMs" -> Json.fromInt(5000),"connectTimeoutMs" -> Json.fromInt(5000),"statementTimeoutMs" -> Json.fromInt(5000),
        "lockTimeoutMs" -> Json.fromInt(5000),"idleTransactionTimeoutMs" -> Json.fromInt(5000),"socketTimeoutMs" -> Json.fromInt(5000))
      val config=Json.obj("data_dir" -> Json.fromString(directory.resolve("nonexistent-data").toString),
        "api_origin" -> Json.fromString("https://api.example.test"),"content_mode" -> Json.fromString("path"),
        "native_mode" -> Json.fromString("shared"),"posix_library" -> Json.fromString(directory.resolve("nonexistent-native.so").toString),
        "users" -> Json.arr(Json.obj("id" -> Json.fromString("operator"),"type" -> Json.fromString("human"),
          "tokens" -> Json.arr(Json.obj("id" -> Json.fromString("primary"),"hashFile" -> Json.fromString(fifo.toString))))),
        "database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/unreachable"),
          "user" -> Json.fromString("unreachable"),"passwordFile" -> Json.fromString(fifo.toString),"limits" -> limits),
        "embedding" -> Json.obj("operationUrl" -> Json.fromString("http://127.0.0.1:1/embeddings"),"model" -> Json.fromString("fixture"),
          "revision" -> Json.fromString("immutable"),"dimensions" -> Json.fromInt(3),"sendDimensions" -> Json.False,
          "documentPrefix" -> Json.fromString(""),"queryPrefix" -> Json.fromString(""),"normalization" -> Json.fromString("cosine"),
          "credentialFile" -> Json.fromString(fifo.toString),"deadlineMs" -> Json.fromInt(5000),"maxResponseBytes" -> Json.fromInt(1024),
          "maxBatch" -> Json.fromInt(1),"maxInputBytes" -> Json.fromInt(1024),"maxRequestBytes" -> Json.fromInt(4096),
          "maxConcurrent" -> Json.fromInt(1),"maxQueued" -> Json.fromInt(1),"batchSize" -> Json.fromInt(1),
          "leaseSeconds" -> Json.fromInt(30),"pollIntervalMs" -> Json.fromInt(1000)))
      val path=directory.resolve("config.json")
      def run(json: Json,expected: Int): String =
        Files.writeString(path,json.noSpaces)
        val childClasspath=sys.props.getOrElse("manure.test.childClasspath",
          throw new IllegalArgumentException("explicit manure.test.childClasspath required"))
        val builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString,"-cp",childClasspath,
          "manure.CheckConfigProbe","check-config",path.toString).redirectErrorStream(true)
        builder.environment().clear()
        val child=builder.start()
        try
          assert(child.waitFor(2,TimeUnit.SECONDS),"check-config touched a blocking reference or external endpoint")
          val outputBytes=Using.resource(child.getInputStream)(_.readNBytes(maximumChildOutputBytes+1))
          assert(outputBytes.length<=maximumChildOutputBytes,"check-config child output bound exceeded")
          val output=Exact.string(outputBytes)
          assertEquals(child.exitValue(),expected,s"child classpath=$childClasspath\nchild output=$output")
          assert(!output.contains(fifo.toString));assert(!output.contains("127.0.0.1:1"));output
        finally
          child.destroyForcibly();child.waitFor(5,TimeUnit.SECONDS)
      assert(run(config,0).contains("MANURE_CONFIG_OK"))
      val passwordOnly = Json.obj("id" -> Json.fromString("browser"),"type" -> Json.fromString("human"),
        "login" -> Json.fromString("browser"),"passwordHashFile" -> Json.fromString(fifo.toString))
      val human = config.mapObject(_.add("users",Json.arr(passwordOnly)))
      assert(run(human,0).contains("MANURE_CONFIG_OK"))
      assertEquals(Config.load(path).users.head.enabled,true)
      assertEquals(Config.load(path).users.head.tokens,Vector.empty)
      val invalidUsers = Vector(
        Json.arr(passwordOnly.mapObject(_.remove("login"))),
        Json.arr(passwordOnly.mapObject(_.add("type",Json.fromString("agent")))),
        Json.arr(passwordOnly,passwordOnly.mapObject(_.add("id",Json.fromString("other")))))
      invalidUsers.foreach(users => assert(!run(config.mapObject(_.add("users",users)),1).contains("MANURE_CONFIG_OK")))
      Vector("strict","inode-anchored","unsafe-off").foreach { mode =>
        assert(run(config.mapObject(_.add("root_binding",Json.obj("mode" -> Json.fromString(mode)))),0).contains("MANURE_CONFIG_OK"))
      }
      Vector(Json.Null,Json.arr(),Json.obj(),Json.obj("mode" -> Json.fromInt(1)),Json.obj("mode" -> Json.Null),Json.obj("mode" -> Json.fromString("off")),
        Json.obj("mode" -> Json.fromString("strict"),"extra" -> Json.True)).foreach { invalid =>
        assert(!run(config.mapObject(_.add("root_binding",invalid)),1).contains("MANURE_CONFIG_OK"))
      }
      val admin = passwordOnly.mapObject(_.add("admin",Json.True))
      val accounts = Json.obj("enabled" -> Json.True,"key_file" -> Json.fromString(fifo.toString),
        "signup" -> Json.obj("enabled" -> Json.True,"require_approval" -> Json.True,"max_users" -> Json.fromInt(100)))
      assert(run(config.mapObject(_.add("users",Json.arr(admin)).add("accounts",accounts)),0).contains("MANURE_CONFIG_OK"))
      val duplicate=config.mapObject(_.add("allowed_api_origins",Json.arr(Json.fromString("https://api.example.test:8443"))))
      assert(!run(duplicate,1).contains("MANURE_CONFIG_OK"))
      assert(!Files.exists(directory.resolve("nonexistent-data")))
    finally
      mkfifo.destroyForcibly()
      Files.deleteIfExists(directory.resolve("config.json"));Files.deleteIfExists(fifo);Files.deleteIfExists(directory)
  }

  test("indexing policy loads from the optional top-level object") {
    val path=Files.createTempFile("manure-indexing-config-",".json")
    val base=CurrentWire.parse("""{
      "data_dir": "/var/lib/manure", "api_origin": "https://artifacts.example.test", "content_mode": "path",
      "users": [{"id": "operator", "type": "human", "login": "operator", "passwordHashFile": "/run/secrets/operator"}],
      "database": {"jdbcUrl": "jdbc:postgresql://127.0.0.1:1/x", "user": "manure", "passwordFile": "/run/secrets/db",
        "limits": {"maxConnections": 1, "maxQueued": 1, "queueTimeoutMs": 5000, "connectTimeoutMs": 5000,
          "statementTimeoutMs": 5000, "lockTimeoutMs": 5000, "idleTransactionTimeoutMs": 5000, "socketTimeoutMs": 5000}}
    }""")
    def load(json: Json): Config =
      Files.writeString(path,json.noSpaces)
      Config.load(path)
    try
      assertEquals(load(base).indexingPolicy,IndexingPolicy(true,false,false))
      val flags=Json.obj("defaultEnabled" -> Json.False,"allowOptIn" -> Json.True,"allowOptOut" -> Json.True)
      assertEquals(load(base.mapObject(_.add("indexing",flags))).indexingPolicy,IndexingPolicy(false,true,true))
      for invalid <- List(Json.Null,Json.obj("defaultEnabled" -> Json.fromInt(0))) do
        assertEquals(intercept[DomainError](load(base.mapObject(_.add("indexing",invalid)))).code,"bad-envelope")
    finally Files.deleteIfExists(path)
  }

  test("D10 database.limits pool keys: omitted, one admission below 8 connections and 3 + 3 at 8; set, together within maxConnections - 2") {
    val directory=Files.createTempDirectory("manure-pool-config-")
    val path=directory.resolve("config.json")
    def pool(limits: (String,Int)*): Option[(Int,Int,Boolean)] =
      val bounds=Vector("queueTimeoutMs","connectTimeoutMs","statementTimeoutMs","lockTimeoutMs","idleTransactionTimeoutMs","socketTimeoutMs").map(_ -> 5000)
      val user=Json.obj("id" -> Json.fromString("operator"),"type" -> Json.fromString("human"),"login" -> Json.fromString("operator"),
        "passwordHashFile" -> Json.fromString("/run/secrets/operator"))
      Files.writeString(path,Json.obj("data_dir" -> Json.fromString("/var/lib/manure"),"api_origin" -> Json.fromString("https://artifacts.example.test"),
        "content_mode" -> Json.fromString("path"),"users" -> Json.arr(user),"database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/x"),
          "user" -> Json.fromString("manure"),"passwordFile" -> Json.fromString("/run/secrets/db"),
          "limits" -> Json.obj((("maxQueued" -> 1) +: (bounds ++ limits)).map((key,value) => key -> Json.fromInt(value))*))).noSpaces)
      try Some(Config.load(path).databasePool).map(p => (p.request,p.background,p.fixed)) catch case _: DomainError => None
    try
      assertEquals(pool("maxConnections" -> 1),Some((1,0,false)))
      assertEquals(pool("maxConnections" -> 8),Some((3,3,true)))
      assertEquals(pool("maxConnections" -> 8,"requestConnections" -> 2,"backgroundConnections" -> 4),Some((2,4,true)))
      assertEquals(pool("maxConnections" -> 8,"requestConnections" -> 3,"backgroundConnections" -> 4),None)
      assertEquals(pool("maxConnections" -> 8,"backgroundConnections" -> 4),None)
    finally
      Files.deleteIfExists(path);Files.deleteIfExists(directory)
  }

  test("accounts and users[].admin are closed key sets; creation flags never imply the master switch") {
    val directory=Files.createTempDirectory("manure-accounts-config-")
    val path=directory.resolve("config.json")
    val limits=Json.obj("maxConnections" -> Json.fromInt(1),"maxQueued" -> Json.fromInt(1)).deepMerge(Json.obj(Vector("queueTimeoutMs",
      "connectTimeoutMs","statementTimeoutMs","lockTimeoutMs","idleTransactionTimeoutMs","socketTimeoutMs").map(_ -> Json.fromInt(5000))*))
    val admin=Json.obj("id" -> Json.fromString("operator"),"type" -> Json.fromString("human"),"login" -> Json.fromString("operator"),
      "passwordHashFile" -> Json.fromString("/run/secrets/operator"),"admin" -> Json.True)
    val base=Json.obj("data_dir" -> Json.fromString("/var/lib/manure"),"api_origin" -> Json.fromString("https://artifacts.example.test"),
      "content_mode" -> Json.fromString("path"),
      "users" -> Json.arr(admin),"database" -> Json.obj("jdbcUrl" -> Json.fromString("jdbc:postgresql://127.0.0.1:1/x"),
        "user" -> Json.fromString("manure"),"passwordFile" -> Json.fromString("/run/secrets/db"),"limits" -> limits))
    val accounts=Json.obj("enabled" -> Json.True,"key_file" -> Json.fromString("/run/credentials/accounts-key"),
      "signup" -> Json.obj("enabled" -> Json.True,"require_approval" -> Json.False,"max_users" -> Json.fromInt(7)),
      "enrollment" -> Json.obj("enabled" -> Json.True,"ttl_s" -> Json.fromInt(600)),
      "issuer" -> Json.fromString("Manure (artifacts)"),"reserved_usernames" -> Json.arr(Json.fromString("boss")))
    def load(json: Json): Option[Config] =
      Files.writeString(path,json.noSpaces)
      try Some(Config.load(path)) catch case _: DomainError => None
    def withAccounts(value: Json): Json = base.mapObject(_.add("accounts",value))
    def nested(key: String,field: String,value: Json): Json = withAccounts(accounts.mapObject(_.add(key,accounts.hcursor.downField(key).focus.get.mapObject(_.add(field,value)))))
    try
      assertEquals(load(base).map(c => (c.accounts,c.users.map(_.admin))),Some((None,Vector(true))))
      assertEquals(load(withAccounts(accounts)).flatMap(_.accounts),Some(AccountsConfig(true,Some(Path.of("/run/credentials/accounts-key")),
        AccountSignupConfig(true,false,7),AccountEnrollmentConfig(true,600),"Manure (artifacts)",Vector("boss"))))
      assertEquals(load(withAccounts(Json.obj("enabled" -> Json.False))).flatMap(_.accounts),Some(AccountsConfig(false,None,
        AccountsConfig.defaultSignup,AccountsConfig.defaultEnrollment,"Manure (artifacts.example.test)",Vector.empty)))
      Vector(
        withAccounts(accounts.mapObject(_.add("keyFile",Json.fromString("/run/k")))),
        nested("signup","requireApproval",Json.True),
        nested("enrollment","ttlSeconds",Json.fromInt(600)),
        base.mapObject(_.add("users",Json.arr(admin.mapObject(_.add("isAdmin",Json.True))))),
        withAccounts(accounts.mapObject(_.add("enabled",Json.False))),
        withAccounts(accounts.mapObject(_.remove("key_file"))),
        withAccounts(accounts.mapObject(_.add("key_file",Json.fromString("relative/key")))),
        withAccounts(accounts.mapObject(_.add("key_file",Json.fromString("/nix/store/key")))),
        withAccounts(accounts.mapObject(_.remove("enabled"))),
        nested("signup","max_users",Json.fromInt(1001)),
        withAccounts(accounts.mapObject(_.add("issuer",Json.fromString("a:b")))),
        base.mapObject(_.add("users",Json.arr(admin.mapObject(_.add("admin",Json.False))))).mapObject(_.add("accounts",accounts)),
        base.mapObject(_.add("users",Json.arr(admin.mapObject(_.add("id",Json.fromString("operator\u0000")))))),
        base.mapObject(_.add("users",Json.arr(admin.mapObject(_.remove("login").remove("passwordHashFile")
          .add("tokens",Json.arr(Json.obj("id" -> Json.fromString("t"),"hashFile" -> Json.fromString("/run/t"))))))))
      ).foreach(json => assertEquals(load(json),None,clue(json.noSpaces)))
    finally
      Files.deleteIfExists(path);Files.deleteIfExists(directory)
  }
