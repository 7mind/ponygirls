package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import chronicle.api.*
import com.comcast.ip4s.*
import distage.*
import io.circe.Json
import org.http4s.{Message as _,Http as _,*}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.implicits.*
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

class AccountHttpTest extends munit.FunSuite {
  override val munitTimeout=90.seconds
  private val root="/api/account/v1"
  private final case class Reply(status: Status,body: String,headers: Headers) {
    def json: Json=Wire.parse(body)
    def cookie: String=headers.get(CIString("Set-Cookie")).get.head.value.takeWhile(_!=';')
    def code: String=json.hcursor.downField("error").get[String]("code").toOption.get
  }
  private final case class Fixture(config: Config,services: RuntimeServices,client: Client[IO],base: String,configured: StaticTokenConfig,configuredSecret: String) {
    def request(method: Method,path: String,cookie: Option[String],body: String,extra: List[(String,String)]): IO[Reply] = {
      val headers=List("Host"->java.net.URI.create(config.allowedOrigin).getRawAuthority,"Origin"->config.allowedOrigin,"Content-Type"->"application/json")++cookie.map("Cookie"->_).toList++extra
      val request=Request[IO](method,Uri.unsafeFromString(base+path)).withEntity(body).putHeaders(headers.map { case (k,v) => Header.Raw(CIString(k),v) }*)
      client.run(request).use(r => r.as[String].map(text => Reply(r.status,text,r.headers))).timeout(10.seconds)
    }
    def login(name: String): IO[Reply]=request(Method.POST,root+"/login",None,s"""{"login":"$name","password":"synthetic"}""",Nil)
    def get(cookie: String): IO[Reply]=request(Method.GET,root,Some(cookie),"",Nil)
    def post(owner: String,path: String,cookie: String,body: String): IO[Reply]=request(Method.POST,root+path,Some(cookie),body,List("X-Account-Actor"->ponygirls.auth.AccountJson.actor(owner)))
  }
  private def fixture: Resource[IO,Fixture] = for {
    config <- Resource.eval(IO {
      if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
      Fixtures.config()
    })
    secret <- Resource.eval(IO(Wire.secret()))
    token <- Resource.eval(IO {
      val file=java.nio.file.Files.createTempFile("chronicle-account-configured-",".secret")
      java.nio.file.Files.setPosixFilePermissions(file,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))
      java.nio.file.Files.writeString(file,secret)
      StaticTokenConfig(java.util.UUID.randomUUID(),"a","configured",List(Scope.Ingest),file.toString)
    })
    actual=config.copy(staticTokens=List(token))
    runtimeClient <- EmberClientBuilder.default[IO].build
    services <- {
      val module=new ModuleDef { include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(actual); make[Client[IO]].fromValue(runtimeClient) }
      ChronicleInjector().produceGet[RuntimeServices](module).toCats[IO]
    }
    _ <- Resource.eval(IO.blocking {
      services.database.initialize()
      services.database.transaction(c => Sql.exec(c,"TRUNCATE ch_tokens,ch_sessions,ch_mutations CASCADE"))
      services.database.initialize()
    })
    gate <- Resource.eval(Semaphore[IO](2))
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => services.http.routes(ws,gate).orNotFound).build
    client <- EmberClientBuilder.default[IO].build
  } yield Fixture(actual,services,client,s"http://127.0.0.1:${server.address.getPort}",token,secret)

  test("BG GoodCommunication specified: common account login settings issue revoke retain Chronicle scopes ownership and one-time secrets") {
    fixture.use { f => for {
      logged <- f.login("a")
      _ <- IO {
        assertEquals(logged.status,Status.Ok)
        assertEquals(logged.json.hcursor.downField("user").get[String]("login").toOption,Some("a"))
        assertEquals(logged.json.hcursor.downField("user").get[String]("actor").toOption,Some(ponygirls.auth.AccountJson.actor("a")))
        val cookie=logged.headers.get(CIString("Set-Cookie")).get.head.value
        assert(cookie.contains(s"Max-Age=${ponygirls.auth.PersistentCookie.maxAgeSeconds}")); assert(cookie.contains("HttpOnly")); assert(cookie.contains("SameSite=Strict")); assert(!cookie.contains("Domain="))
      }
      settings <- f.get(logged.cookie)
      _ <- IO {
        assertEquals(settings.status,Status.Ok)
        assertEquals(settings.json.hcursor.get[Vector[String]]("scopes").toOption,Some(Vector("Ingest","Read","Raw")))
        val tokens=settings.json.hcursor.get[Vector[Json]]("tokens").toOption.get
        assertEquals(tokens.size,1)
        assertEquals(tokens.head.hcursor.get[String]("source").toOption,Some("configured"))
        assertEquals(tokens.head.hcursor.get[String]("id").toOption,Some(f.configured.id.toString))
        assert(!settings.body.contains(f.configuredSecret)); assert(!settings.body.contains("passwordHash"))
      }
      immutable <- f.post("a",s"/tokens/${f.configured.id}/revoke",logged.cookie,"{}")
      _ <- IO { assertEquals(immutable.status,Status.Forbidden); assertEquals(immutable.code,"forbidden") }
      issued <- f.post("a","/tokens",logged.cookie,"""{"name":"runtime","scopes":["Read"]}""")
      _ <- IO(assertEquals(issued.status,Status.Ok))
      secret=issued.json.hcursor.get[String]("secret").toOption.get
      id=issued.json.hcursor.downField("token").get[String]("id").toOption.get
      _ <- IO.blocking {
        val auth=new Auth(f.services.database,f.config)
        assertEquals(auth.bearer(secret).user.scopes,List(Scope.Read))
        assertEquals(intercept[DomainError](auth.browser(secret)).code,"unauthorized")
        assertEquals(intercept[DomainError](auth.bearer(logged.cookie.stripPrefix("chronicle_session="))).code,"unauthorized")
      }
      listed <- f.get(logged.cookie)
      _ <- IO { assert(!listed.body.contains(secret)); assert(listed.body.contains(id)); assertEquals(listed.headers.get(CIString("Cache-Control")).map(_.head.value),Some("no-store")) }
      invalid <- List("[]","[\"Raw\"]","[\"api\"]","[\"Read\",\"Read\"]").traverse(scopes => f.post("a","/tokens",logged.cookie,s"""{"name":"invalid","scopes":$scopes}"""))
      _ <- IO(invalid.foreach(reply => assertEquals(reply.status,Status.BadRequest)))
      other <- f.login("b")
      forbidden <- f.post("b",s"/tokens/$id/revoke",other.cookie,"{}")
      _ <- IO { assertEquals(forbidden.status,Status.NotFound); assertEquals(forbidden.code,"not-found") }
      revoked <- f.post("a",s"/tokens/$id/revoke",logged.cookie,"{}")
      _ <- IO { assertEquals(revoked.status,Status.Ok); assertEquals(revoked.json,Json.obj("ok"->Json.True)) }
      _ <- IO.blocking(assertEquals(intercept[DomainError](new Auth(f.services.database,f.config).bearer(secret)).code,"unauthorized"))
      logout <- f.post("a","/logout",logged.cookie,"{}")
      replay <- f.get(logged.cookie)
      _ <- IO { assertEquals(logout.status,Status.Ok); assertEquals(replay.status,Status.Unauthorized) }
      _ <- IO.blocking(assertEquals(new Auth(f.services.database,f.config).bearer(f.configuredSecret).user.scopes,List(Scope.Ingest)))
    } yield () }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: account HTTP rejects ambiguous credentials hostile Origin Host query and malformed bodies") {
    fixture.use { f => for {
      logged <- f.login("a")
      rejected <- List(
        f.request(Method.GET,root+"?secret=synthetic",Some(logged.cookie),"",Nil).map(_ -> Status.BadRequest),
        f.request(Method.GET,root,Some(logged.cookie),"",List("Authorization"->"Bearer synthetic")).map(_ -> Status.Forbidden),
        f.request(Method.GET,root,None,"",List("Authorization"->s"Bearer ${f.configuredSecret}")).map(_ -> Status.Forbidden),
        f.request(Method.GET,root,Some(logged.cookie),"",List("Cookie"->logged.cookie)).map(_ -> Status.Forbidden),
        f.request(Method.GET,root,Some(logged.cookie+"; "+logged.cookie),"",Nil).map(_ -> Status.Forbidden),
        f.request(Method.GET,root,Some(logged.cookie),"",List("Host"->"evil.invalid")).map(_ -> Status.Forbidden),
        f.request(Method.POST,root+"/tokens",Some(logged.cookie),"{}",List("Origin"->"https://evil.invalid")).map(_ -> Status.Forbidden),
        f.request(Method.POST,root+"/login",None,"""{"login":"a","login":"b","password":"synthetic"}""",Nil).map(_ -> Status.BadRequest),
        f.request(Method.POST,root+"/login",None,"""{"login":"a","password":"synthetic","extra":true}""",Nil).map(_ -> Status.BadRequest),
        f.post("a","/logout",logged.cookie,"{not-json}").map(_ -> Status.BadRequest),
        f.post("a","/logout",logged.cookie,"{\"extra\":true}").map(_ -> Status.BadRequest),
        f.request(Method.POST,root+"/login",None," "*16385,Nil).map(_ -> Status.PayloadTooLarge)
      ).sequence
      _ <- IO(rejected.foreach { case (reply,status) =>
        assertEquals(reply.status,status)
        assert(reply.json.hcursor.downField("error").succeeded)
        assert(!reply.body.contains("synthetic")); assert(!reply.body.contains(f.configuredSecret))
        assertEquals(reply.headers.get(CIString("Cache-Control")).map(_.head.value),Some("no-store"))
        assertEquals(reply.headers.get(CIString("Set-Cookie")),None)
      })
      valid <- f.get(logged.cookie)
      badLogin <- f.request(Method.POST,root+"/login",None,"""{"login":"a","password":"wrong synthetic"}""",Nil)
      _ <- IO { assertEquals(valid.status,Status.Ok); assertEquals(badLogin.status,Status.Unauthorized); assertEquals(badLogin.code,"unauthorized") }
    } yield () }.unsafeRunSync()
  }

  private def ownerLock(f: Fixture): Resource[IO,java.sql.Connection] = Resource.make(IO.blocking {
    val c=java.sql.DriverManager.getConnection(f.config.jdbcUrl,f.config.databaseUser,Config.credential(f.config.databasePasswordFile))
    c.setAutoCommit(false)
    Sql.lock(c,"mutation:a")
    c
  })(c => IO.blocking { try c.rollback() finally c.close() })

  test("BG GoodCommunication specified: account issue and revoke revalidate after the shared owner mutation lock") {
    fixture.use { f =>
      List("issue","revoke").traverse_ { operation => List("logout","disabled").traverse_ { invalidation => for {
        _ <- IO.blocking(f.services.database.initialize())
        logged <- f.login("a")
        issued <- f.post("a","/tokens",logged.cookie,"""{"name":"existing","scopes":["Read"]}""")
        id=issued.json.hcursor.downField("token").get[String]("id").toOption.get
        _ <- ownerLock(f).use { holder =>
          val request=if(operation=="issue") f.post("a","/tokens",logged.cookie,"""{"name":"must-not-issue","scopes":["Read"]}""") else f.post("a",s"/tokens/$id/revoke",logged.cookie,"{}")
          Resource.make(request.start)(fiber => IO.blocking(holder.rollback()) *> fiber.cancel).use { fiber => for {
            pid <- IO.blocking(Sql.one(holder,"SELECT pg_backend_pid()")(_.getInt(1)).get)
            _ <- McpTestFixtures.await(IO.blocking(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid))",pid)(_.getInt(1)).get)))(_>=1)
            _ <- IO.blocking {
              if(invalidation=="logout") new Auth(f.services.database,f.config).logout(new Auth(f.services.database,f.config).browser(logged.cookie.stripPrefix("chronicle_session=")))
              else f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"))
            }
            _ <- IO.blocking(holder.commit())
            reply <- fiber.joinWithNever
            _ <- IO(assertEquals(reply.status,Status.Unauthorized))
          } yield () }
        }
        _ <- IO.blocking(f.services.database.transaction { c =>
          assertEquals(Sql.one(c,"SELECT count(*) FROM ch_tokens WHERE info->>'name'='must-not-issue'")(_.getInt(1)).get,0)
          assert(!Sql.one(c,"SELECT revoked FROM ch_tokens WHERE id=?",java.util.UUID.fromString(id))(_.getBoolean(1)).get)
        })
      } yield () } }
    }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: account mutations reject a cookie switched to another tab's actor") {
    fixture.use { f => for {
      original <- f.login("a")
      _ <- f.get(original.cookie)
      switched <- f.login("b")
      existing <- f.post("b","/tokens",switched.cookie,"""{"name":"existing","scopes":["Read"]}""")
      id=existing.json.hcursor.downField("token").get[String]("id").toOption.get
      denied <- List(
        f.post("a","/tokens",switched.cookie,"""{"name":"wrong-account","scopes":["Read"]}"""),
        f.post("a",s"/tokens/$id/revoke",switched.cookie,"{}"),
        f.post("a","/logout",switched.cookie,"{}")
      ).sequence
      _ <- IO(denied.foreach { reply => assertEquals(reply.status,Status.Conflict); assertEquals(reply.code,"conflict") })
      malformed <- List(
        f.request(Method.POST,root+"/tokens",Some(switched.cookie),"""{"name":"invalid","scopes":["Read"]}""",Nil),
        f.request(Method.POST,root+"/logout",Some(switched.cookie),"{}",List("X-Account-Actor"->"malformed")),
        f.request(Method.POST,root+"/logout",Some(switched.cookie),"{}",List("X-Account-Actor"->ponygirls.auth.AccountJson.actor("b"),"X-Account-Actor"->ponygirls.auth.AccountJson.actor("b")))
      ).sequence
      _ <- IO(malformed.foreach { reply => assertEquals(reply.status,Status.BadRequest); assertEquals(reply.code,"invalid") })
      listed <- f.get(switched.cookie)
      _ <- IO(assert(!listed.body.contains("wrong-account")))
    } yield () }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: account settings revalidate after a blocked token listing before returning metadata or cookies") {
    fixture.use { f => List("logout","disabled","reassigned").traverse_ { mode => for {
      _ <- IO.blocking(f.services.database.initialize())
      logged <- f.login("a")
      _ <- Resource.make(IO.blocking {
        val c=java.sql.DriverManager.getConnection(f.config.jdbcUrl,f.config.databaseUser,Config.credential(f.config.databasePasswordFile))
        c.setAutoCommit(false)
        Sql.exec(c,"LOCK TABLE ch_tokens IN ACCESS EXCLUSIVE MODE")
        c
      })(c => IO.blocking { try c.rollback() finally c.close() }).use { holder =>
        Resource.make(f.get(logged.cookie).start)(fiber => IO.blocking(holder.rollback()) *> fiber.cancel).use { request => for {
          pid <- IO.blocking(Sql.one(holder,"SELECT pg_backend_pid()")(_.getInt(1)).get)
          _ <- McpTestFixtures.await(IO.blocking(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid))",pid)(_.getInt(1)).get)))(_>=1)
          _ <- IO.blocking {
            val auth=new Auth(f.services.database,f.config)
            mode match {
              case "logout" => auth.logout(auth.browser(logged.cookie.stripPrefix("chronicle_session=")))
              case "disabled" => f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"))
              case "reassigned" => f.services.database.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET owner='b' WHERE hash=?",Wire.hash(logged.cookie.stripPrefix("chronicle_session="))))
            }
          }
          _ <- IO.blocking(holder.commit())
          reply <- request.joinWithNever
          _ <- IO {
            assertEquals(reply.status,Status.Unauthorized)
            assertEquals(reply.code,"unauthorized")
            assertEquals(reply.headers.get(CIString("Set-Cookie")),None)
            assert(!reply.body.contains(f.configured.id.toString))
          }
        } yield () }
      }
    } yield () } }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: account database failure is unavailable rather than invalid credentials") {
    fixture.use { f => for {
      logged <- f.login("a")
      _ <- IO.blocking(f.services.database.close())
      settings <- f.get(logged.cookie)
      login <- f.login("a")
      _ <- IO(List(settings,login).foreach { reply => assertEquals(reply.status,Status.ServiceUnavailable); assertEquals(reply.code,"unavailable") })
    } yield () }.unsafeRunSync()
  }
}
