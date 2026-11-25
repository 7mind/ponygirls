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
import ponygirls.auth.{IndexingPolicy,Totp}
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
    def signup(name: String,requireTotp: Boolean): IO[Reply] = IO(Totp.code(Totp.decodeSecret(totpSecret).get,Totp.stepAt(java.time.Instant.now()))).flatMap { code =>
      request(Method.POST,root+"/signup",None,s"""{"username":"$name","email":"$name@example.test","password":"$imperativePassword","totpSecret":"$totpSecret","totpCode":"$code","requireTotp":$requireTotp}""",Nil)
    }
    def legacyLogin(name: String,password: String): IO[Reply]=request(Method.POST,"/api/login",None,Wire.encode(LoginRequest.codecJson,LoginRequest(name,password)).noSpaces,Nil)
    def restart(config: Config): Unit = { val database=new Database(config,services.database.profiles); try database.initialize() finally database.close() }
  }
  private val imperativePassword="synthetic imperative"
  private val totpSecret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  private def username(): String="u"+java.util.UUID.randomUUID().toString.take(8)
  private def imperativeAccounts(requireApproval: Boolean): AccountsConfig = {
    val key=java.nio.file.Files.createTempFile("chronicle-accounts-",".key")
    java.nio.file.Files.setPosixFilePermissions(key,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))
    java.nio.file.Files.writeString(key,Wire.secret())
    AccountsConfig(true,Some(key.toString),SignupConfig(true,requireApproval,AccountsConfig.defaultMaxUsers),EnrollmentConfig(false,AccountsConfig.defaultEnrollmentTtlSeconds),None,Nil)
  }
  // Removes the accounts a case created together with their projections, so no later suite sees them.
  private def clearImperative(database: Database): Unit = database.transaction { c =>
    List("ch_sessions","ch_tokens","ch_owner_targets").foreach(table => Sql.exec(c,s"DELETE FROM $table WHERE owner IN(SELECT id FROM ponygirls_imperative_users)"))
    Sql.exec(c,"DELETE FROM ch_users WHERE id IN(SELECT id FROM ponygirls_imperative_users)")
    Sql.exec(c,"DELETE FROM ponygirls_imperative_users")
  }
  private def fixture: Resource[IO,Fixture] = fixture(None)
  private def fixture(accounts: Option[AccountsConfig],indexingPolicy: Option[IndexingPolicy] = None): Resource[IO,Fixture] = for {
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
    actual=config.copy(staticTokens=List(token),accounts=accounts,indexingPolicy=indexingPolicy.getOrElse(config.indexingPolicy),
      users=config.users.map(user => user.copy(admin=(accounts.nonEmpty || indexingPolicy.nonEmpty) && user.id=="a")))
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
    _ <- if(accounts.isEmpty) Resource.unit[IO] else Resource.make(IO.blocking(clearImperative(services.database)))(_ => IO.blocking(clearImperative(services.database)))
    plane <- services.http.accountPlane
    gate <- Resource.eval(Semaphore[IO](2))
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => services.http.routes(ws,gate,plane).orNotFound).build
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
      // Without `accounts.enabled` no imperative-account route is registered.
      unregistered <- List(f.request(Method.GET,root+"/policy",None,"",Nil),f.request(Method.POST,root+"/signup",None,"{}",Nil)).sequence
      _ <- IO(unregistered.foreach(reply => assertEquals(reply.status,Status.NotFound)))
    } yield () }.unsafeRunSync()
  }

  test("indexing works with signup off, and a session revoked under the SQL session lock cannot clear an override") {
    fixture(None,Some(IndexingPolicy(false,true,false))).use { f =>
      val self="/indexing"
      val admin="/admin/indexing"
      def read(path: String,cookie: String): IO[Reply] = f.request(Method.GET,root+path,Some(cookie),"",Nil)
      def overrideBody(choice: String,password: String): String = s"""{"userId":"b","override":"$choice","currentPassword":"$password"}"""
      for {
        operator <- f.login("a")
        member <- f.login("b")
        before <- read(self,member.cookie)
        _ <- IO {
          assertEquals(before.status,Status.Ok)
          assertEquals(before.json.hcursor.get[Boolean]("enabled"),Right(false))
          assertEquals(before.headers.get(CIString("Cache-Control")).map(_.head.value),Some("no-store"))
          assertEquals(before.headers.get(CIString("Set-Cookie")),None)
        }
        bearer <- f.request(Method.GET,root+self,None,"",List("Authorization" -> s"Bearer ${f.configuredSecret}"))
        old <- read("/admin/users",operator.cookie)
        rejected <- read(admin,member.cookie)
        entity <- f.request(Method.GET,root+self,Some(member.cookie),"{}",Nil)
        stale <- f.post("a",self,member.cookie,"""{"choice":"enabled"}""")
        duplicate <- f.post("b",self,member.cookie,"""{"choice":"enabled","choice":"disabled"}""")
        _ <- IO(assertEquals(Vector(bearer.status,old.status,rejected.status,entity.status,stale.status,duplicate.status),
          Vector(Status.Forbidden,Status.NotFound,Status.Forbidden,Status.BadRequest,Status.Conflict,Status.BadRequest)))
        enabled <- f.post("b",self,member.cookie,"""{"choice":"enabled"}""")
        denied <- f.post("a",admin,operator.cookie,overrideBody("disabled","wrong synthetic password"))
        forced <- f.post("a",admin,operator.cookie,overrideBody("disabled","synthetic"))
        _ <- IO {
          assertEquals((enabled.status,enabled.json.hcursor.get[Boolean]("enabled")),(Status.Ok,Right(true)))
          assertEquals((denied.status,denied.code),(Status.Forbidden,"proof-rejected"))
          assert(!denied.body.contains("synthetic password"))
          assertEquals((forced.status,forced.json),(Status.Ok,Json.obj("ok" -> Json.True)))
        }
        sessionHash=Wire.hash(operator.cookie.stripPrefix("chronicle_session="))
        _ <- Resource.make(IO.blocking {
          val c=java.sql.DriverManager.getConnection(f.config.jdbcUrl,f.config.databaseUser,Config.credential(f.config.databasePasswordFile))
          c.setAutoCommit(false)
          Sql.one(c,"SELECT hash FROM ch_sessions WHERE hash=? FOR UPDATE",sessionHash)(_.getString(1))
          c
        })(c => IO.blocking { try c.rollback() finally c.close() }).use { holder =>
          Resource.make(f.post("a",admin,operator.cookie,overrideBody("inherit","synthetic")).start)(fiber => IO.blocking(holder.rollback()) *> fiber.cancel).use { request => for {
            pid <- IO.blocking(Sql.one(holder,"SELECT pg_backend_pid()")(_.getInt(1)).get)
            _ <- McpTestFixtures.await(IO.blocking(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid))",pid)(_.getInt(1)).get)))(_>=1)
            _ <- IO.blocking { Sql.exec(holder,"DELETE FROM ch_sessions WHERE hash=?",sessionHash); holder.commit() }
            reply <- request.joinWithNever
            _ <- IO(assertEquals((reply.status,reply.code),(Status.Unauthorized,"unauthorized")))
          } yield () }
        }
        stillForced <- read(self,member.cookie)
        _ <- IO(assertEquals((stillForced.json.hcursor.get[String]("choice"),stillForced.json.hcursor.get[String]("override"),stillForced.json.hcursor.get[Boolean]("enabled")),
          (Right("enabled"),Right("disabled"),Right(false))))
        signedIn <- f.login("a")
        cleared <- f.post("a",admin,signedIn.cookie,overrideBody("inherit","synthetic"))
        restored <- read(self,member.cookie)
        reset <- f.post("b",self,member.cookie,"""{"choice":"inherit"}""")
        _ <- IO {
          assertEquals(cleared.status,Status.Ok)
          assertEquals(restored.json.hcursor.get[Boolean]("enabled"),Right(true))
          assertEquals((reset.status,reset.json.hcursor.get[Boolean]("enabled")),(Status.Ok,Right(false)))
        }
      } yield ()
    }.unsafeRunSync()
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

  test("BG GoodCommunication specified: imperative signup approval login profile and logout project the approved account into ch_users and ch_owner_targets") {
    fixture(Some(imperativeAccounts(true))).use { f => for {
      name <- IO(username())
      applied <- f.signup(name,false)
      _ <- IO.blocking {
        assertEquals(applied.status,Status.Accepted)
        assertEquals(applied.headers.get(CIString("Set-Cookie")),None)
        assertEquals(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_users WHERE id=?",name)(_.getInt(1))),Some(0))
      }
      admin <- f.login("a")
      approved <- f.post("a",s"/admin/users/$name/approve",admin.cookie,"{}")
      _ <- IO.blocking {
        assertEquals(approved.status,Status.Ok)
        f.services.database.transaction { c =>
          assertEquals(Sql.one(c,"SELECT u.login,u.enabled,u.credential=i.password_hash FROM ch_users u JOIN ponygirls_imperative_users i ON i.id=u.id WHERE u.id=?",name)(r => (r.getString(1),r.getBoolean(2),r.getBoolean(3))),Some((name,true,true)))
          assertEquals(Sql.one(c,"SELECT profile FROM ch_owner_targets WHERE owner=?",name)(_.getString(1)),Some(f.services.database.profiles.preferred.profile))
        }
      }
      logged <- f.request(Method.POST,root+"/login",None,s"""{"login":"$name","password":"$imperativePassword"}""",Nil)
      profile <- f.request(Method.GET,root+"/profile",Some(logged.cookie),"",Nil)
      settings <- f.get(logged.cookie)
      logout <- f.post(name,"/logout",logged.cookie,"{}")
      replay <- f.request(Method.GET,root+"/profile",Some(logged.cookie),"",Nil)
      _ <- IO {
        assertEquals(logged.status,Status.Ok)
        assertEquals(logged.json.hcursor.downField("user").get[String]("id").toOption,Some(name))
        assertEquals(profile.status,Status.Ok)
        assertEquals(profile.json.hcursor.get[String]("source").toOption,Some("imperative"))
        assertEquals(profile.json.hcursor.get[Boolean]("admin").toOption,Some(false))
        assertEquals(profile.json.hcursor.get[String]("email").toOption,Some(s"$name@example.test"))
        assertEquals(settings.json.hcursor.downField("user").get[String]("login").toOption,Some(name))
        assertEquals(logout.status,Status.Ok)
        assertEquals(replay.status,Status.Unauthorized)
      }
    } yield () }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: a retained ch_users id or login cannot be registered and its row archive and tokens stay unchanged") {
    fixture(Some(imperativeAccounts(false))).use { f =>
      val suffix=username()
      val removed=UserConfig("Kept-"+suffix,"Mail-"+suffix,f.config.users.head.passwordHashFile,true,false)
      val source=java.util.UUID.randomUUID(); val token=java.util.UUID.randomUUID()
      def retained: (Option[String],Option[String],Option[String],Option[Int]) = f.services.database.transaction { c => (
        Sql.one(c,"SELECT login||' '||enabled||' '||credential FROM ch_users WHERE id=?",removed.id)(_.getString(1)),
        Sql.one(c,"SELECT owner FROM ch_sources WHERE id=?",source)(_.getString(1)),
        Sql.one(c,"SELECT owner||' '||hash||' '||revoked FROM ch_tokens WHERE id=?",token)(_.getString(1)),
        Sql.one(c,"SELECT (SELECT count(*) FROM ch_users)+(SELECT count(*) FROM ponygirls_imperative_users)")(_.getInt(1))) }
      Resource.make(IO.blocking {
        // Configured, used, then removed from configuration: the row stays, disabled.
        f.restart(f.config.copy(users=f.config.users:+removed))
        f.services.database.transaction { c =>
          Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key) VALUES(?,?,?)",source,removed.id,"retained")
          Sql.exec(c,"INSERT INTO ch_tokens(id,owner,hash,info) VALUES(?,?,?,?::jsonb)",token,removed.id,Wire.hash(Wire.secret()),Wire.encode(TokenInfo.codecJson,TokenInfo(token,"retained",List(Scope.Read),java.time.Instant.now().toString,false)).noSpaces)
        }
        f.restart(f.config)
        retained
      })(_ => IO.blocking(f.services.database.transaction { c =>
        List("ch_sources","ch_tokens","ch_owner_targets").foreach(table => Sql.exec(c,s"DELETE FROM $table WHERE owner=?",removed.id))
        Sql.exec(c,"DELETE FROM ch_users WHERE id=?",removed.id); ()
      })).use { before => for {
        refused <- List(removed.id,removed.login).traverse(taken => f.signup(taken.toLowerCase,false))
        after <- IO.blocking(retained)
        _ <- IO {
          assertEquals(before._1,Some(s"${removed.login} false ${Config.credential(removed.passwordHashFile)}"))
          assertEquals(before._2,Some(removed.id))
          refused.foreach { reply => assertEquals(reply.status,Status.Conflict); assertEquals(reply.code,"username-unavailable"); assertEquals(reply.headers.get(CIString("Set-Cookie")),None) }
          assertEquals(after,before)
        }
      } yield () }
    }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: restart keeps an active imperative account enabled with accounts on suspends it with accounts off and leaves its token intact") {
    fixture(Some(imperativeAccounts(false))).use { f => for {
      name <- IO(username())
      signed <- f.signup(name,false)
      issued <- f.post(name,"/tokens",signed.cookie,"""{"name":"runtime","scopes":["Read"]}""")
      _ <- IO { assertEquals(signed.status,Status.Ok); assertEquals(issued.status,Status.Ok) }
      secret=issued.json.hcursor.get[String]("secret").toOption.get
      _ <- IO.blocking {
        val auth=new Auth(f.services.database,f.config)
        // enabled projection, live browser sessions, stored token state, bearer accepted
        def state: (Option[Boolean],Option[Int],Option[String],Boolean) = {
          val stored=f.services.database.transaction { c => (
            Sql.one(c,"SELECT enabled FROM ch_users WHERE id=?",name)(_.getBoolean(1)),
            Sql.one(c,"SELECT count(*) FROM ch_sessions WHERE owner=?",name)(_.getInt(1)),
            Sql.one(c,"SELECT t.hash||' '||t.revoked||' '||i.status FROM ch_tokens t JOIN ponygirls_imperative_users i ON i.id=t.owner WHERE t.owner=?",name)(_.getString(1))) }
          (stored._1,stored._2,stored._3,scala.util.Try(auth.bearer(secret)).isSuccess)
        }
        val token=Some(s"${Wire.hash(secret)} false active")
        val suspended=(Some(false),Some(0),token,false)
        // The master switch is explicit: a creation flag without it, no key file or no enabled administrator is a configuration fault.
        val on=f.config.accounts.get
        f.config.validate()
        List(f.config.copy(accounts=Some(on.copy(enabled=false))),f.config.copy(accounts=Some(on.copy(keyFile=None))),f.config.copy(users=f.config.users.map(_.copy(admin=false))))
          .foreach(invalid => assertEquals(intercept[DomainError](invalid.validate()).code,"config"))
        assertEquals(Wire.parse("""{"enabled":true,"keyFile":"/run/accounts-key"}""").as[AccountsConfig](using Config.given_Decoder_AccountsConfig).toOption,
          Some(AccountsConfig(true,Some("/run/accounts-key"),SignupConfig(false,true,100),EnrollmentConfig(false,86400),None,Nil)))
        f.restart(f.config)
        assertEquals(state,(Some(true),Some(1),token,true))
        f.restart(f.config.copy(accounts=None))
        assertEquals(state,suspended)
        f.services.database.transaction { c =>
          assertEquals(Database.activeImperativeAccounts(c),1)
          assertEquals(Database.imperativeAccountsSealedByAnotherKey(c,ponygirls.auth.TotpVault.load(java.nio.file.Path.of(on.keyFile.get),AccountsConfig.service).keyId),0)
          assertEquals(Database.imperativeAccountsSealedByAnotherKey(c,"another key"),1)
        }
        // A configured login equal to the suspended account fails closed and writes nothing.
        val colliding=f.config.copy(accounts=None,users=f.config.users:+UserConfig("declared-"+name,name.toUpperCase,f.config.users.head.passwordHashFile,true,false))
        assertEquals(intercept[DomainError](f.restart(colliding)).code,"config")
        assertEquals(state,suspended)
        f.restart(f.config)
        assertEquals(state,(Some(true),Some(0),token,true))
      }
    } yield () }.unsafeRunSync()
  }

  test("BG GoodCommunication specified: legacy login refuses a mandatory-TOTP imperative account commits its wrong-password failure and signs in other accounts") {
    fixture(Some(imperativeAccounts(false))).use { f =>
      def failures(name: String): IO[Option[Int]] = IO.blocking(f.services.database.transaction(c => Sql.one(c,"SELECT password_failures FROM ponygirls_imperative_users WHERE id=?",name)(_.getInt(1))))
      for {
        strict <- IO(username())
        plain <- IO(username())
        _ <- f.signup(strict,true)
        _ <- f.signup(plain,false)
        refused <- f.legacyLogin(strict,imperativePassword)
        clean <- failures(strict)
        wrong <- f.legacyLogin(strict,"wrong "+imperativePassword)
        counted <- failures(strict)
        accepted <- f.legacyLogin(plain,imperativePassword)
        configured <- f.legacyLogin("a","synthetic")
        account <- f.get(accepted.cookie)
        // The login methods behind both routes decide an imperative login themselves and raise its rejection only after the counting transaction committed.
        _ <- IO.blocking {
          val auth=new Auth(f.services.database,f.config)
          def failed: Option[Int] = f.services.database.transaction(c => Sql.one(c,"SELECT password_failures FROM ponygirls_imperative_users WHERE id=?",plain)(_.getInt(1)))
          assertEquals(intercept[DomainError](auth.login(LoginRequest(plain,"wrong "+imperativePassword))).code,"unauthorized")
          assertEquals(failed,Some(1))
          assertEquals(intercept[DomainError](auth.accountLogin(plain,"wrong "+imperativePassword)).code,"unauthorized")
          assertEquals(failed,Some(2))
          assertEquals(auth.browser(auth.login(LoginRequest(plain,imperativePassword))._2).user.id,plain)
          val (user,secret)=auth.accountLogin(plain,imperativePassword)
          assertEquals((user.id,auth.browser(secret).user.id),(plain,plain))
          assertEquals(failed,Some(0))
          assertEquals(intercept[DomainError](auth.accountLogin(strict,imperativePassword)).code,"totp-required")
        }
        _ <- IO {
          List(refused,wrong).foreach { reply =>
            assertEquals(reply.status,Status.Unauthorized)
            assertEquals(reply.json.hcursor.get[String]("code").toOption,Some("unauthorized"))
            assertEquals(reply.headers.get(CIString("Set-Cookie")),None)
          }
          assertEquals(clean,Some(0))
          assertEquals(counted,Some(1))
          assertEquals(accepted.status,Status.Ok)
          assertEquals(account.json.hcursor.downField("user").get[String]("id").toOption,Some(plain))
          assertEquals(configured.status,Status.Ok)
        }
      } yield ()
    }.unsafeRunSync()
  }
}
