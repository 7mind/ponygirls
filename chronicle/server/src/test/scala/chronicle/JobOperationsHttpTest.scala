package chronicle
import chronicle.api.*
import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import distage.*
import io.circe.Json
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import java.util.UUID

/** Job operations for tokens (R-f) through the production routes and PostgreSQL. */
class JobOperationsHttpTest extends munit.FunSuite {
  private final case class Reply(status: Status,body: String,headers: Headers) {
    def json: Json=Wire.parse(body)
  }
  private val scopesHeader="X-Account-Scopes"
  private val allScopes=scopesHeader->"all"
  private final class Fixture(val config: Config,val services: RuntimeServices,app: HttpApp[IO]) {
    val auth=new Auth(services.database,config)
    def send(request: Request[IO]): Reply = app.run(request).flatMap(r => r.as[String].map(Reply(r.status,_,r.headers))).unsafeRunSync()
    def login(owner: String): String = auth.login(LoginRequest(owner,"synthetic"))._2
    def account(method: Method,path: String,owner: String,cookie: String,body: String,extra: List[(String,String)]): Reply = {
      val headers=List("Host"->java.net.URI.create(config.allowedOrigin).getRawAuthority,"Origin"->config.allowedOrigin,"Content-Type"->"application/json","Cookie"->s"chronicle_session=$cookie","X-Account-Actor"->ponygirls.auth.AccountJson.actor(owner))++extra
      send(Request[IO](method,Uri.unsafeFromString(Http.accountPrefix+path)).withEntity(body).putHeaders(headers.map((k,v) => Header.Raw(CIString(k),v))*))
    }
    def settings(owner: String,cookie: String,extra: List[(String,String)]): Reply = account(Method.GET,"",owner,cookie,"",extra)
    def issue(owner: String,cookie: String,scopes: String,extra: List[(String,String)]): Reply = account(Method.POST,"/tokens",owner,cookie,s"""{"name":"agent","scopes":$scopes}""",extra)
    /** A token issued in Settings with Read and OperateJobs: its secret and id. */
    def operator(owner: String): (String,UUID) = {
      val issued=issue(owner,login(owner),"""["Read","OperateJobs"]""",List(allScopes))
      assertEquals(issued.status,Status.Ok,issued.body)
      (issued.json.hcursor.get[String]("secret").toOption.get,UUID.fromString(issued.json.hcursor.downField("token").get[String]("id").toOption.get))
    }
    def operateJobs(id: UUID): Boolean = services.database.transaction(c => Sql.one(c,"SELECT operate_jobs FROM ch_tokens WHERE id=?",id)(_.getBoolean(1)).get)
  }
  private def scopes(json: Json): Vector[String] = json.hcursor.get[Vector[String]]("scopes").toOption.get
  private def tokenScopes(json: Json,id: UUID): Vector[String] =
    json.hcursor.get[Vector[Json]]("tokens").toOption.get.find(_.hcursor.get[String]("id").toOption.contains(id.toString)).flatMap(_.hcursor.get[Vector[String]]("scopes").toOption).get

  private def withFixture(body: Fixture => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val config=Fixtures.config()
    val resources=for {
      client <- EmberClientBuilder.default[IO].build
      services <- ChronicleInjector().produceGet[RuntimeServices](new ModuleDef {
        include(_root_.chronicle.plugins.ChroniclePlugin); make[Config].fromValue(config); make[Client[IO]].fromValue(client)
      }).toCats[IO]
      ws <- Resource.eval(WebSocketBuilder2[IO])
      gate <- Resource.eval(Semaphore[IO](2))
    } yield (services,services.http.routes(ws,gate).orNotFound)
    val ((services,app),release)=resources.allocated.unsafeRunSync()
    try {
      services.database.initialize()
      services.database.transaction { c =>
        Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations,ch_collector_progress CASCADE")
        Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
        Sql.exec(c,"UPDATE ch_users SET enabled=true")
      }
      body(new Fixture(config,services,app))
    } finally release.unsafeRunSync()
  }

  test("R-f S9: the account API names OperateJobs only on opt-in, and no typed value carries it") { withFixture { f =>
    val cookie=f.login("a")
    val legacy=f.settings("a",cookie,Nil)
    assertEquals(legacy.status,Status.Ok); assertEquals(scopes(legacy.json),Vector("Ingest","Read","Raw"))
    assertEquals(f.issue("a",cookie,"""["Read","OperateJobs"]""",Nil).status,Status.BadRequest)
    val issued=f.issue("a",cookie,"""["Read","OperateJobs"]""",List(allScopes))
    assertEquals(issued.status,Status.Ok,issued.body)
    assertEquals(issued.json.hcursor.downField("token").get[Vector[String]]("scopes").toOption,Some(Vector("Read","OperateJobs")))
    val secret=issued.json.hcursor.get[String]("secret").toOption.get
    val id=UUID.fromString(issued.json.hcursor.downField("token").get[String]("id").toOption.get)
    assert(f.operateJobs(id))
    val opted=f.settings("a",cookie,List(allScopes))
    assertEquals(scopes(opted.json),Vector("Ingest","Read","Raw","OperateJobs")); assertEquals(tokenScopes(opted.json,id),Vector("Read","OperateJobs"))
    val unchanged=f.settings("a",cookie,Nil)
    assertEquals(scopes(unchanged.json),Vector("Ingest","Read","Raw")); assertEquals(tokenScopes(unchanged.json,id),Vector("Read"))
    assertEquals(f.auth.bearer(secret).user.scopes,List(Scope.Read))
    assertEquals(f.auth.tokens(f.auth.browser(cookie)).tokens.map(_.info.scopes),List(List(Scope.Read)))
    List("""["OperateJobs"]""","""["Raw","OperateJobs"]""","""["Read","OperateJobs","OperateJobs"]""","""["Read","Read","OperateJobs"]""").foreach { requested =>
      assertEquals(f.issue("a",cookie,requested,List(allScopes)).status,Status.BadRequest,requested)
    }
    List(List(allScopes,allScopes),List(scopesHeader->"typed")).foreach { header =>
      assertEquals(f.settings("a",cookie,header).status,Status.BadRequest)
      assertEquals(f.issue("a",cookie,"""["Read"]""",header).status,Status.BadRequest)
    }
    assertEquals(f.services.database.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_tokens")(_.getInt(1)).get),1)
  }}
}
