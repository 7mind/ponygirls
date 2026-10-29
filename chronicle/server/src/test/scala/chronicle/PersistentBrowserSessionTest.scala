package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import com.comcast.ip4s.*
import distage.*
import org.http4s.{Message as _,Http as _,*}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.implicits.*
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

class PersistentBrowserSessionTest extends munit.FunSuite {
  override val munitTimeout=90.seconds
  private final case class Reply(status: Status,body: String,headers: Headers) {
    def header(name: String): Option[String]=headers.get(CIString(name)).map(_.head.value)
    def cookie: String=header("Set-Cookie").get.takeWhile(_!=';')
  }
  private final case class Fixture(config: Config,services: RuntimeServices,client: Client[IO],base: String) {
    def post(path: String,headers: List[(String,String)],body: String): IO[Reply] = {
      val request=Request[IO](Method.POST,Uri.unsafeFromString(base+path)).withEntity(body).putHeaders(headers.map { case (k,v) => Header.Raw(CIString(k),v) }*)
      client.run(request).use(r => r.as[String].map(text => Reply(r.status,text,r.headers))).timeout(10.seconds)
    }
    def browserPost(path: String,cookie: String): IO[Reply]=post(path,List("Origin"->config.allowedOrigin,"Cookie"->cookie),"")
    def login: IO[Reply]=post("/api/login",List("Origin"->config.allowedOrigin),Wire.encode(LoginRequest.codecJson,LoginRequest("a","synthetic")).noSpaces)
    def remaining(cookie: String): IO[Double]=IO.blocking(services.database.transaction(c => Sql.one(c,"SELECT extract(epoch FROM expires-clock_timestamp()) FROM ch_sessions WHERE hash=?",Wire.hash(cookie.stripPrefix("chronicle_session=")))(_.getDouble(1)).get))
  }
  private def fixture(ttl: Int,secure: Boolean): Resource[IO,Fixture] = for {
    _ <- Resource.eval(IO {
      if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    })
    config <- Resource.eval(IO(Fixtures.config().copy(sessionTtlSeconds=ttl,secureCookies=secure,allowedOrigin=if(secure) "https://chronicle.invalid" else "http://127.0.0.1:8448",allowInsecureHttp= !secure)))
    runtimeClient <- EmberClientBuilder.default[IO].build
    services <- {
      val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(config); make[Client[IO]].fromValue(runtimeClient) }
      ChronicleInjector().produceGet[RuntimeServices](module).toCats[IO]
    }
    _ <- Resource.eval(IO.blocking { services.database.initialize(); services.database.transaction(c => Sql.exec(c,"DELETE FROM ch_sessions")) })
    gate <- Resource.eval(Semaphore[IO](2))
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => services.http.routes(ws,gate).orNotFound).build
    // The browser client must release pooled connections before the server's graceful shutdown.
    client <- EmberClientBuilder.default[IO].build
  } yield Fixture(config,services,client,s"http://127.0.0.1:${server.address.getPort}")

  // Specified-origin: the browser renewal contract, including configured rather than hard-coded TTL.
  List((2592000,true),(37,false)).foreach { case (ttl,secure) =>
    test(s"Effectual GoodCommunication specified: renewable cookie HTTP and database TTL agree ($ttl, secure=$secure)") {
      fixture(ttl,secure).use { f => for {
        logged <- f.login
        _ <- IO { assertEquals(logged.status,Status.Ok); assert(logged.header("Set-Cookie").get.contains(s"Max-Age=$ttl")) }
        before <- f.remaining(logged.cookie)
        _ <- IO(assert(before<=ttl && before>ttl-10))
        _ <- IO.blocking(f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '15 seconds'")))
        refreshed <- f.browserPost("/api/session/refresh",logged.cookie)
        _ <- IO {
          assertEquals(refreshed.status,Status.Ok)
          assertEquals(Wire.decode(UserInfo.codecJson,Wire.parse(refreshed.body)),Wire.decode(LoginResponse.codecJson,Wire.parse(logged.body)).user)
          assertEquals(refreshed.cookie,logged.cookie)
          assertEquals(refreshed.header("X-Chronicle-Session-Ttl-Seconds"),Some(ttl.toString))
          assertEquals(refreshed.header("Cache-Control"),Some("no-store"))
          val cookie=refreshed.header("Set-Cookie").get
          assert(cookie.contains(s"Max-Age=$ttl")); assert(cookie.contains("HttpOnly")); assert(cookie.contains("SameSite=Strict")); assert(cookie.contains("Path=/"))
          assertEquals(cookie.split(";").exists(_.trim.equalsIgnoreCase("Secure")),secure)
        }
        after <- f.remaining(logged.cookie)
        _ <- IO(assert(after<=ttl && after>ttl-10))
        _ <- IO.blocking {
          // A fresh service instance and full initialization preserve the unchanged persisted secret.
          val restarted=new Database(f.config,f.services.database.profiles)
          restarted.initialize()
          assertEquals(new Auth(restarted,f.config).browser(logged.cookie.stripPrefix("chronicle_session=")).user.id,"a")
        }
        logout <- f.browserPost("/api/logout",logged.cookie)
        _ <- IO(assertEquals(logout.status,Status.Ok))
        revoked <- f.browserPost("/api/session/refresh",logged.cookie)
        _ <- IO { assertEquals(revoked.status,Status.Unauthorized); assertEquals(revoked.header("Set-Cookie"),None) }
      } yield () }.unsafeRunSync()
    }
  }

  test("Effectual GoodCommunication specified: refresh enforces exact Origin query and cookie-only controls without touching expiry") {
    fixture(2592000,false).use { f => for {
      logged <- f.login
      before <- IO.blocking(f.services.database.transaction(c => Sql.one(c,"SELECT expires FROM ch_sessions WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session=")))(_.getTimestamp(1)).get))
      denied <- List(
        f.post("/api/session/refresh",List("Cookie"->logged.cookie),"").map(_ -> Status.Forbidden),
        f.post("/api/session/refresh",List("Cookie"->logged.cookie,"Origin"->(f.config.allowedOrigin+".evil")),"").map(_ -> Status.Forbidden),
        f.browserPost("/api/session/refresh?secret=synthetic",logged.cookie).map(_ -> Status.BadRequest),
        f.post("/api/session/refresh",List("Origin"->f.config.allowedOrigin,"Cookie"->logged.cookie,"Authorization"->"Bearer synthetic"),"").map(_ -> Status.Forbidden),
        f.post("/api/session/refresh",List("Origin"->f.config.allowedOrigin),"").map(_ -> Status.Unauthorized),
        f.browserPost("/api/session/refresh","chronicle_session=missing").map(_ -> Status.Unauthorized),
        f.post("/api/session/refresh",List("Origin"->f.config.allowedOrigin,"Authorization"->"Bearer synthetic"),"").map(_ -> Status.Forbidden)
      ).sequence
      _ <- IO(denied.foreach { case (reply,status) => assertEquals(reply.status,status); assertEquals(reply.header("Set-Cookie"),None); assert(!reply.body.contains("synthetic")) })
      after <- IO.blocking(f.services.database.transaction(c => Sql.one(c,"SELECT expires FROM ch_sessions WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session=")))(_.getTimestamp(1)).get))
      _ <- IO(assertEquals(after,before))
      mixedLogout <- f.post("/api/logout",List("Origin"->f.config.allowedOrigin,"Cookie"->logged.cookie,"Authorization"->"Bearer synthetic"),"")
      _ <- IO(assertEquals(mixedLogout.status,Status.Forbidden))
    } yield () }.unsafeRunSync()
  }

  // Specified-origin feature interaction: a benign lifetime extension must not erase any owner's in-flight MCP runs.
  test("BG GoodCommunication specified: session renewal preserves captured authority for the same and unrelated owners") {
    fixture(2592000,false).use { f => for {
      logged <- f.login
      auth=new Auth(f.services.database,f.config)
      owner <- IO.blocking(auth.browser(logged.cookie.stripPrefix("chronicle_session=")))
      other <- IO.blocking(auth.browser(auth.login(LoginRequest("b","synthetic"))._2))
      authorization=new PostgresRunAuthorization(f.services.database,auth)
      stamps <- List(owner,other).traverse(authorization.capture)
      refreshed <- f.browserPost("/api/session/refresh",logged.cookie)
      _ <- IO(assertEquals(refreshed.status,Status.Ok))
      outcomes <- stamps.traverse(stamp => authorization.verify(stamp).attempt)
      _ <- IO {
        val results=outcomes.map(_.left.map { case d: DomainError => d.code; case _ => "unexpected failure" }.map(_.user.id))
        assertEquals(results,List[Either[String,String]](Right("a"),Right("b")))
      }
    } yield () }.unsafeRunSync()
  }

  private def sessionLock(f: Fixture,cookie: String): Resource[IO,java.sql.Connection] =
    Resource.make(IO.blocking(java.sql.DriverManager.getConnection(f.config.jdbcUrl,f.config.databaseUser,Config.credential(f.config.databasePasswordFile))))(c => IO.blocking { try c.rollback() finally c.close() }).evalTap(c => IO.blocking {
      c.setAutoCommit(false)
      assert(Sql.one(c,"SELECT hash FROM ch_sessions WHERE hash=? FOR UPDATE",Wire.hash(cookie.stripPrefix("chronicle_session=")))(_.getString(1)).nonEmpty)
    })

  private def awaitBlocked(f: Fixture,holder: java.sql.Connection,minimum: Int): IO[Unit] = for {
    pid <- IO.blocking(Sql.one(holder,"SELECT pg_backend_pid()")(_.getInt(1)).get)
    // A bounded real-PG barrier, not a timing-only race: the HTTP transaction must actually be waiting on our lock.
    _ <- McpTestFixtures.await(IO.blocking(f.services.database.transaction(c => Sql.one(c,"WITH RECURSIVE blocked(pid) AS (SELECT pid FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*) FROM blocked",pid)(_.getInt(1)).get)))(_>=minimum)
  } yield ()

  private def lockedRequest(f: Fixture,holder: java.sql.Connection,path: String,cookie: String): Resource[IO,cats.effect.FiberIO[Reply]] =
    Resource.make(f.browserPost(path,cookie).start)(fiber => IO.blocking(holder.rollback()) *> fiber.cancel)

  List("expiry","logout").foreach { boundary =>
    test(s"Effectual GoodCommunication specified: renewal blocked at existing row cannot revive $boundary") {
      fixture(2592000,false).use { f => for {
        logged <- f.login
        _ <- if(boundary=="expiry") IO.blocking(f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '5 seconds' WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session="))))).void else IO.unit
        _ <- sessionLock(f,logged.cookie).use { holder => lockedRequest(f,holder,"/api/session/refresh",logged.cookie).use { renewal => for {
          _ <- awaitBlocked(f,holder,1)
          _ <- if(boundary=="expiry") f.remaining(logged.cookie).flatMap { seconds => IO(assert(seconds>0,"renewal must begin while the session is still valid")) *> IO.sleep((seconds+0.1).seconds) }
            else IO.blocking(Sql.exec(holder,"DELETE FROM ch_sessions WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session=")))).void
          _ <- IO.blocking(holder.commit())
          response <- renewal.joinWithNever
          _ <- IO { assertEquals(response.status,Status.Unauthorized); assertEquals(response.header("Set-Cookie"),None) }
        } yield () }}
        denied <- f.browserPost("/api/session/refresh",logged.cookie)
        _ <- IO(assertEquals(denied.status,Status.Unauthorized))
        _ <- if(boundary=="logout") IO.blocking(assertEquals(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_sessions")(_.getInt(1)).get),0)) else IO.unit
      } yield () }.unsafeRunSync()
    }
  }

  test("BG GoodCommunication specified: a raw expiry extension blocked beyond expiry still invalidates authority at actual trigger time") {
    fixture(2592000,false).use { f => for {
      logged <- f.login
      auth=new Auth(f.services.database,f.config)
      other <- IO.blocking(auth.browser(auth.login(LoginRequest("b","synthetic"))._2))
      authorization=new PostgresRunAuthorization(f.services.database,auth)
      _ <- IO.blocking(f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '5 seconds' WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session=")))))
      stamp <- authorization.capture(other)
      _ <- sessionLock(f,logged.cookie).use { holder =>
        val raw=IO.blocking(f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '1 day' WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session=")))))
        Resource.make(raw.start)(fiber => IO.blocking(holder.rollback()) *> fiber.cancel).use { update => for {
          _ <- awaitBlocked(f,holder,1)
          seconds <- f.remaining(logged.cookie)
          _ <- IO(assert(seconds>0,"raw update must begin while the old session is live"))
          _ <- IO.sleep((seconds+0.1).seconds)
          _ <- IO.blocking(holder.commit())
          _ <- update.joinWithNever
        } yield () }
      }
      rejected <- authorization.verify(stamp).attempt
      _ <- IO(rejected match {
        case Left(error: DomainError) => assertEquals(error.code,"authorization-changed")
        case _ => fail("an expired session revival must not receive the benign-renewal exemption")
      })
      fresh <- authorization.capture(other)
      _ <- authorization.verify(fresh)
    } yield () }.unsafeRunSync()
  }

  test("Effectual GoodCommunication specified: concurrent HTTP logout and renewal never recreate a deleted session") {
    fixture(2592000,false).use { f => for {
      logged <- f.login
      _ <- sessionLock(f,logged.cookie).use { holder => lockedRequest(f,holder,"/api/session/refresh",logged.cookie).use { renewal => for {
        _ <- awaitBlocked(f,holder,1)
        _ <- lockedRequest(f,holder,"/api/logout",logged.cookie).use { logout => for {
          _ <- awaitBlocked(f,holder,2)
          _ <- IO.blocking(holder.commit())
          renewed <- renewal.joinWithNever
          loggedOut <- logout.joinWithNever
          _ <- IO { assert(Set(Status.Ok,Status.Unauthorized).contains(renewed.status)); assertEquals(loggedOut.status,Status.Ok) }
        } yield () }
      } yield () }}
      denied <- f.browserPost("/api/session/refresh",logged.cookie)
      _ <- IO { assertEquals(denied.status,Status.Unauthorized); assertEquals(denied.header("Set-Cookie"),None) }
      _ <- IO.blocking(assertEquals(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_sessions")(_.getInt(1)).get),0))
    } yield () }.unsafeRunSync()
  }

  test("Effectual GoodCommunication specified: expired disabled removed and password-changed sessions cannot be revived") {
    fixture(2592000,false).use { f =>
      List("expired","disabled","removed","password").traverse_ { mode => for {
        _ <- IO.blocking(f.services.database.initialize())
        logged <- f.login
        _ <- IO.blocking {
          if(mode=="expired") f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp() WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session="))))
          else {
            val changed=mode match {
              case "disabled" => f.config.copy(users=f.config.users.map(u => if(u.id=="a") u.copy(enabled=false) else u))
              case "removed" => f.config.copy(users=f.config.users.filterNot(_.id=="a"))
              case "password" =>
                val file=java.nio.file.Files.createTempFile("chronicle-password-change-",".txt")
                java.nio.file.Files.writeString(file,Password.hash("different synthetic".toCharArray))
                f.config.copy(users=f.config.users.map(u => if(u.id=="a") u.copy(passwordHashFile=file.toString) else u))
            }
            new Database(changed,f.services.database.profiles).initialize()
          }
        }
        denied <- f.browserPost("/api/session/refresh",logged.cookie)
        _ <- IO { assertEquals(denied.status,Status.Unauthorized); assertEquals(denied.header("Set-Cookie"),None) }
        _ <- IO.blocking(f.services.database.initialize())
        stillDenied <- f.browserPost("/api/session/refresh",logged.cookie)
        _ <- IO(assertEquals(stillDenied.status,Status.Unauthorized))
      } yield () }
    }.unsafeRunSync()
  }
}
