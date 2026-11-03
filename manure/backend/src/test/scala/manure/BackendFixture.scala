package manure

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import java.nio.file.{Files,Path}
import java.sql.DriverManager
import scala.util.Using
import scala.jdk.CollectionConverters.*
import manure.storage.*
import ponygirls.runtime.{JdbcDatabase,JdbcConfig}
import ponygirls.retrieval.postgres.PostgresRetrieval
import io.circe.Json

final class TestClock(var now: Double) extends DomainClock
final class TestFaults extends Faults:
  var armed = Set.empty[String]
  def apply(window: String): Unit =
    if armed(window) then
      armed -= window
      throw DomainError("unavailable")
final case class BackendFixture(config: Config,rootPath: Path,root: ConfinedDirectory,lease: RootLease,
  auth: Auth,identity: Identity,other: Identity,clock: TestClock,faults: TestFaults,metadata: Metadata,
  artifacts: Artifacts,payloads: Payloads,token: String,database: Option[JdbcTransactions],projection: Option[SearchProjection])

object BackendFixture:
  val source: Path = Path.of(sys.env.getOrElse("MANURE_SOURCE_ROOT",throw new IllegalArgumentException("MANURE_SOURCE_ROOT required")))
  private def temporary: Resource[IO,Path] = Resource.make(IO.blocking(Files.createTempDirectory("manure-backend-test-"))) { path => IO.blocking {
    Using.resource(Files.walk(path))(_.iterator().asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)))
  }}
  private def ownedDatabase: Resource[IO,String] =
    Require(sys.env.get("MANURE_TEST_ALLOW_CREATEDB").contains("1"), "unavailable")
    val url = sys.env.getOrElse("MANURE_TEST_JDBC_URL",throw new IllegalArgumentException("required owned PG leg unavailable"))
    val user = sys.env.getOrElse("MANURE_TEST_JDBC_USER","postgres")
    val password = Files.readString(Path.of(sys.env("MANURE_TEST_JDBC_PASSWORD_FILE"))).stripSuffix("\n")
    val id = "manure_test_" + java.util.UUID.randomUUID().toString.replace("-","")
    def execute(sql: String): IO[Unit] = IO.blocking {
      Class.forName("org.postgresql.Driver")
      Using.resource(DriverManager.getConnection(url,user,password))(c => Using.resource(c.createStatement())(_.execute(sql)))
      ()
    }
    Resource.make(execute("CREATE DATABASE " + id).as(url.substring(0,url.lastIndexOf('/')+1) + id))(_ => execute("DROP DATABASE " + id + " WITH (FORCE)"))
  /** Every production-adapter scenario uses a real non-owner runtime role.
    * Administration exists only in this freshly created disposable fixture.
    */
  private def runtimeRole(temp: Path,url: String): Resource[IO,(String,Path)] =
    val user="manure_runtime_"+java.util.UUID.randomUUID().toString.replace("-","")
    val password=SecretCodec.token();val file=temp.resolve("runtime-password")
    val admin=sys.env.getOrElse("MANURE_TEST_JDBC_USER","postgres")
    val adminPassword=Files.readString(Path.of(sys.env("MANURE_TEST_JDBC_PASSWORD_FILE"))).stripSuffix("\n")
    val database=url.substring(url.lastIndexOf('/')+1)
    def execute(sql: String): IO[Unit] = IO.blocking {
      Using.resource(DriverManager.getConnection(url,admin,adminPassword)) { c => Using.resource(c.createStatement())(_.execute(sql)) };()
    }
    val acquire=IO.blocking(Files.writeString(file,password+"\n")) *>
      execute("CREATE ROLE " + user + " LOGIN PASSWORD '"+password+"' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT") *>
      execute("CREATE EXTENSION IF NOT EXISTS vector; REVOKE ALL ON DATABASE " + database + " FROM PUBLIC; GRANT CONNECT ON DATABASE " + database + " TO " + user + "; REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SCHEMA manure; GRANT USAGE,CREATE ON SCHEMA public,manure TO " + user)
    Resource.make(acquire.as((user,file)))(_ => execute("DROP OWNED BY " + user + " CASCADE; DROP ROLE " + user))

  def config(path: Path,url: String,token: String,otherToken: String,quota: Long): Config =
    val hash = path.resolve("owner.hash"); Files.writeString(hash,SecretCodec.sha256(token)+"\n")
    val otherHash = path.resolve("other.hash"); Files.writeString(otherHash,SecretCodec.sha256(otherToken)+"\n")
    val configFile = path.resolve("config.json")
    val root = Files.createDirectory(path.resolve("payloads"))
    val password = sys.env.getOrElse("MANURE_TEST_JDBC_PASSWORD_FILE",path.resolve("dummy-password").toString)
    if !Files.exists(Path.of(password)) then Files.writeString(Path.of(password),"dummy\n")
    val json = Json.obj("data_dir" -> Json.fromString(root.toString),"api_origin" -> Json.fromString("http://127.0.0.1:0"),
      "listen_address" -> Json.fromString("127.0.0.1"),"port" -> Json.fromInt(0),"content_mode" -> Json.fromString("path"),
      "content_suffix" -> Json.fromString(""),"loopback_dev" -> Json.True,"storage_quota_bytes" -> Json.fromLong(quota),
      "native_mode" -> Json.fromString("shared"),"posix_library" -> Json.fromString(sys.env("MANURE_POSIX_LIBRARY")),
      "dashboard_dir" -> Json.fromString(source.resolve("manure/web/dashboard").toString),
      "unlock_shell_dir" -> Json.fromString(source.resolve("manure/web/unlock").toString),
      "users" -> Json.arr(Json.obj("id" -> Json.fromString("owner\u0000馬"),"type" -> Json.fromString("human"),"tokens" -> Json.arr(Json.obj("id" -> Json.fromString("primary"),"hashFile" -> Json.fromString(hash.toString)))),
        Json.obj("id" -> Json.fromString("other"),"type" -> Json.fromString("agent"),"tokens" -> Json.arr(Json.obj("id" -> Json.fromString("primary"),"hashFile" -> Json.fromString(otherHash.toString))))),
      "database" -> Json.obj("jdbcUrl" -> Json.fromString(url),"user" -> Json.fromString(sys.env.getOrElse("MANURE_TEST_JDBC_USER","postgres")),"passwordFile" -> Json.fromString(password),
        "limits" -> Json.obj("maxConnections" -> Json.fromInt(4),"maxQueued" -> Json.fromInt(16),"queueTimeoutMs" -> Json.fromInt(5000),"connectTimeoutMs" -> Json.fromInt(5000),"statementTimeoutMs" -> Json.fromInt(30000),"lockTimeoutMs" -> Json.fromInt(5000),"idleTransactionTimeoutMs" -> Json.fromInt(30000),"socketTimeoutMs" -> Json.fromInt(30000))))
    Files.writeString(configFile,json.noSpaces); Config.load(configFile)
  def configuration: Resource[IO,(Config,String,String)] = for
    temp <- temporary
    url <- ownedDatabase
    token <- Resource.eval(IO(SecretCodec.token()))
    other <- Resource.eval(IO(SecretCodec.token()))
    role <- runtimeRole(temp,url)
    base <- Resource.eval(IO.blocking(config(temp,url,token,other,21474836480L)))
    cfg = base.copy(database=base.database.copy(user=role._1,passwordFile=role._2))
  yield (cfg,token,other)
  def resource(postgres: Boolean,quota: Long = 21474836480L): Resource[IO,BackendFixture] = for
    temp <- temporary
    url <- if postgres then ownedDatabase else Resource.pure[IO,String]("jdbc:postgresql://127.0.0.1:1/unused")
    token <- Resource.eval(IO(SecretCodec.token()))
    otherToken <- Resource.eval(IO(SecretCodec.token()))
    role <- if postgres then runtimeRole(temp,url).map(Some(_)) else Resource.pure[IO,Option[(String,Path)]](None)
    base <- Resource.eval(IO.blocking(config(temp,url,token,otherToken,quota)))
    cfg = role.map(r => base.copy(database=base.database.copy(user=r._1,passwordFile=r._2))).getOrElse(base)
    bridge <- Resource.eval(IO.blocking(PosixNative.shared(sys.env("MANURE_POSIX_LIBRARY"))))
    root <- Resource.make(IO.blocking(ConfinedDirectory.open(cfg.dataDir,bridge)))(r => IO.blocking(r.close()))
    lease <- Resource.make(IO.blocking(root.lease()))(l => IO.blocking(l.close()))
    db <- if postgres then JdbcDatabase.resource(cfg.database).map(Some(_)) else Resource.pure[IO,Option[JdbcDatabase]](None)
    transactions = db.map { d => new JdbcTransactions { def transaction[A](f: java.sql.Connection => A): IO[A] = d.transaction(c => lease.run(f(c))) } }
    engine = new PostgresRetrieval("manure",None)
    projection = new SearchProjection(cfg,engine)
    _ <- Resource.eval(transactions.traverse_(_.transaction { c =>
      val sql = Files.readString(source.resolve("manure/migration/schema.sql"))
      Using.resource(c.createStatement())(_.execute(sql)); projection.initialize(c)
    }))
    repo: Metadata = transactions.map(t => new PostgresMetadata(t,lease,projection)).getOrElse(new MemoryMetadata(lease))
    gate <- Resource.eval(Semaphore[IO](1L))
    auth = new Auth(cfg.users)
    clock = new TestClock(1700000000.125)
    faults = new TestFaults
    payloads = new FilesystemPayloads(root,cfg.limits)
    service = new Artifacts(repo,payloads,cfg.limits,clock,auth,lease,gate,faults)
    _ <- Resource.eval(service.initialize())
  yield BackendFixture(cfg,cfg.dataDir,root,lease,auth,auth.authenticate(token).get,auth.authenticate(otherToken).get,clock,faults,repo,service,payloads,token,transactions,if postgres then Some(projection) else None)
