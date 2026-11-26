package haystack.auth

import cats.effect.IO
import haystack.api
import haystack.application.ItemService
import haystack.http.{Http,LiveHub,Wire}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import io.circe.Json
import java.util.concurrent.atomic.AtomicInteger
import org.http4s.{Header,Method,Request,Response,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.postgres.PostgresRetrieval

/** How many times one request authenticates its caller, through the production routes and an owned PostgreSQL.
  * `AccountService` reads the configuration exactly once per account decision (a credential resolved, a captured
  * credential checked, an account operation's transaction), so the reads of its own supplier count them. For a
  * session cookie each one is a database lookup, in a transaction of its own unless an account operation makes it. */
class HttpAuthenticationCountTest extends ContractSuite {
  import AuthFixtures.*
  private val Key="p:a"
  private final class Served(http:Http,ws:WebSocketBuilder2[IO],session:String,decisions:AtomicInteger) {
    /** The response, its body and the account decisions the request took, as the browser session of alice. */
    def send(method:Method,path:String,body:Option[Json]):IO[(Response[IO],String,Int)]={
      val headers=List(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Origin"),Secure),Header.Raw(CIString("Cookie"),"__Host-haystack="+session))++
        body.map(_=>Header.Raw(CIString("Content-Type"),"application/json"))
      val plain=Request[IO](method,Uri.unsafeFromString(path))
      val request=headers.foldLeft(body.fold(plain)(json=>plain.withEntity(json.noSpaces)))((r,header)=>r.putHeaders(header))
      for {
        _<-IO(decisions.set(0))
        response<-http.routes(ws).orNotFound(request)
        text<-response.as[String]
      } yield (response,text,decisions.get())
    }
  }
  private def served(body:Served=>IO[Unit]):Unit=directory { dir=>
    val auth=Auth.load(passwordConfig(dir))
    run(TestSupport.emptyDatabase.use { db=>for {
      _<-Migrations.initialize(db,TestSupport.Activity)
      decisions=new AtomicInteger
      accounts=new AccountService(db,()=>{decisions.incrementAndGet();auth},imperative)
      _<-accounts.install(auth)
      signed<-accounts.login("alice",AlicePassword,None)
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("authentication-count-test",true,Vector.empty,4096),new PostgresRetrieval("haystack",None),None,4)
      repository=new PostgresItemRepository(db,Some(retrieval))
      _<-repository.initializeProjection()
      _<-repository.commit(TestSupport.op(Key,document=TestSupport.doc("harbour notes")),TestSupport.Bot,TestSupport.Now)
      hub<-LiveHub.create
      http=new Http(()=>auth,new ItemService(repository,(_,_)=>IO.unit),hub,None,retrieval,accounts)
      ws<-WebSocketBuilder2[IO]
      _<-body(new Served(http,ws,signed.session.secret,decisions))
    } yield ()})
  }
  private def parsed(text:String):Json=io.circe.parser.parse(text).fold(throw _,identity)

  test("retrieve: before the body, after the body, before delivery, and the access log's own lookup") { served { s=>
    val request=Wire.encode(api.RetrieveRequest.codecJson,api.RetrieveRequest("harbour",api.RetrievalMode.Lexical,Some("p"),false,0,10))
    s.send(Method.POST,"/api/v1/retrieve",Some(request)).map { (response,text,decisions)=>
      assertEquals(response.status,Status.Ok,text)
      assertEquals(Wire.decode(api.RetrieveResult.codecJson,parsed(text)).sources.map(_.key),List(Key))
      assertEquals(decisions,4)
    }
  }}
}
