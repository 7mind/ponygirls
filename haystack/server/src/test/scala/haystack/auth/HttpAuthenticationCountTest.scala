package haystack.auth

import cats.effect.IO
import haystack.api
import haystack.application.ItemService
import haystack.http.{Http,LiveHub,Wire}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import io.circe.Json
import java.io.{ByteArrayOutputStream,PrintStream}
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.atomic.AtomicInteger
import org.http4s.{Header,Method,Request,Response,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.auth.AccountJson
import ponygirls.retrieval.postgres.PostgresRetrieval

/** How many times one request authenticates its caller, and what its access-log row says of the caller, through the
  * production routes and an owned PostgreSQL. `AccountService` reads the configuration exactly once per account
  * decision (a credential resolved, a captured credential checked, an account operation's transaction), so the reads
  * of its own supplier count them. For a session cookie each one is a database lookup, in a transaction of its own
  * unless an account operation makes it. */
class HttpAuthenticationCountTest extends ContractSuite {
  import AuthFixtures.*
  private val Key="p:a"
  private val SessionLabel="<session>"
  private val HostHeader="Host"->"ts.test:8445"
  private val OriginHeader="Origin"->Secure
  private val JsonBody="Content-Type"->"application/json"
  /** A browser session: its cookie secret and the token label its log rows carry. */
  private final case class Browser(secret:String,tokenId:String) {
    def cookie:(String,String)="Cookie"->("__Host-haystack="+secret)
  }
  /** One request as its response and its access-log row tell it, with the account decisions it took. */
  private final case class Observed(request:String,status:Int,route:String,identity:Option[(String,String)],decisions:Int) {
    /** One line, so that a difference names its request. */
    def line:String=s"$request: status $status, route $route, caller ${identity.fold("none")((user,token)=>s"$user/$token")}, account decisions $decisions"
  }
  private final class Served(http:Http,ws:WebSocketBuilder2[IO],val accounts:AccountService,decisions:AtomicInteger) {
    private def rows(output:ByteArrayOutputStream):Vector[Json]=
      new String(output.toByteArray,UTF_8).linesIterator.flatMap(line=>io.circe.parser.parse(line).toOption).filter(_.hcursor.downField("route").succeeded).toVector
    /** Runs the request alone: its one log row, read from the process output as an operator reads it. */
    def observe(label:String,browser:Browser,method:Method,path:String,body:Option[String],headers:(String,String)*):IO[(Observed,Response[IO],String)]={
      val plain=Request[IO](method,Uri.unsafeFromString(path))
      val request=headers.foldLeft(body.fold(plain)(plain.withEntity(_)))((r,header)=>r.putHeaders(Header.Raw(CIString(header._1),header._2)))
      IO {
        val output=new ByteArrayOutputStream();val original=System.out
        System.setOut(new PrintStream(output,true,UTF_8))
        (output,original)
      }.bracket { (output,_)=>for {
        _<-IO(decisions.set(0))
        response<-http.routes(ws).orNotFound(request)
        text<-response.as[String]
        taken=decisions.get()
        row=rows(output) match {
          case Vector(one)=>one
          case other=>fail(s"$label: one access-log row expected, got ${other.map(_.noSpaces)}")
        }
        caller=(row.hcursor.get[String]("userId").toOption,row.hcursor.get[String]("tokenId").toOption) match {
          case (Some(user),Some(token))=>Some(user->(if(token==browser.tokenId)SessionLabel else token))
          case (None,None)=>None
          case partial=>fail(s"$label: userId and tokenId are logged together, got $partial")
        }
        _=assertEquals(row.hcursor.get[Int]("status").toOption,Some(response.status.code),label)
      } yield (Observed(label,response.status.code,row.hcursor.get[String]("route").fold(throw _,identity),caller,taken),response,text) }((_,original)=>IO(System.setOut(original)))
    }
    def browser(secret:String):IO[Browser]=accounts.resolve(RequestHeaders(HostHeader._2,cookie=Vector("__Host-haystack="+secret))).map(a=>Browser(secret,a.principal.tokenId))
  }
  private def served(body:(Served,Browser)=>IO[Unit]):Unit=directory { dir=>
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
      _<-body(new Served(http,ws,accounts,decisions),Browser(signed.session.secret,signed.session.credential.tokenId))
    } yield ()})
  }
  private def encoded[A](codec:baboon.runtime.shared.BaboonJsonCodec[A],value:A):Option[String]=Some(Wire.encode(codec,value).noSpaces)
  private def parsed(text:String):Json=io.circe.parser.parse(text).fold(throw _,identity)

  test("each route authenticates as often as its contract names, and its access-log row names the caller as before") { served { (s,alice)=>
    val session=Some("alice"->SessionLabel)
    val actor="X-Account-Actor"->AccountJson.actor("alice")
    val upgrade=Vector("Connection"->"Upgrade","Upgrade"->"websocket","Sec-WebSocket-Version"->"13","Sec-WebSocket-Key"->java.util.Base64.getEncoder.encodeToString(Array.fill[Byte](16)(7)))
    val retrieve=encoded(api.RetrieveRequest.codecJson,api.RetrieveRequest("harbour",api.RetrievalMode.Lexical,Some("p"),false,0,10))
    val toolsList=Some(Json.obj("jsonrpc"->Json.fromString("2.0"),"id"->Json.fromInt(1),"method"->Json.fromString("tools/list")).noSpaces)
    for {
      (get,_,_)<-s.observe("get",alice,Method.POST,"/api/v1/get",encoded(api.GetRequest.codecJson,api.GetRequest(Key,None)),HostHeader,OriginHeader,JsonBody,alice.cookie)
      (missing,_,missingText)<-s.observe("get of a missing item",alice,Method.POST,"/api/v1/get",encoded(api.GetRequest.codecJson,api.GetRequest("p:none",None)),HostHeader,OriginHeader,JsonBody,alice.cookie)
      _=assertEquals(Wire.decode(api.Failure.codecJson,parsed(missingText)).code,"not-found")
      (stranger,_,_)<-s.observe("get with an unknown session",alice,Method.POST,"/api/v1/get",encoded(api.GetRequest.codecJson,api.GetRequest(Key,None)),HostHeader,OriginHeader,JsonBody,"Cookie"->("__Host-haystack="+AliceSession))
      (retrieved,_,retrievedText)<-s.observe("retrieve",alice,Method.POST,"/api/v1/retrieve",retrieve,HostHeader,OriginHeader,JsonBody,alice.cookie)
      _=assertEquals(Wire.decode(api.RetrieveResult.codecJson,parsed(retrievedText)).sources.map(_.key),List(Key))
      (whoami,whoamiResponse,_)<-s.observe("whoami",alice,Method.GET,"/api/v1/whoami",None,HostHeader,alice.cookie)
      (capabilities,capabilitiesResponse,_)<-s.observe("capabilities",alice,Method.GET,"/api/v1/capabilities",None,HostHeader,alice.cookie)
      (analyze,analyzeResponse,analyzed)<-s.observe("query analysis",alice,Method.POST,"/api/v1/query/analyze",encoded(api.QueryRequest.codecJson,api.QueryRequest("type:fact",9)),HostHeader,OriginHeader,JsonBody,alice.cookie)
      _=assertEquals(Wire.decode(api.AnalyzeResult.codecJson,parsed(analyzed)).valid,true)
      // These handlers cannot wait: the session cookie is renewed from the last check, which admitted them.
      _=List(whoamiResponse,capabilitiesResponse,analyzeResponse).foreach(response=>assertEquals(response.headers.get(CIString("Set-Cookie")).map(_.head.value),Some(Sessions.serialize(Some(alice.secret),true))))
      (health,_,_)<-s.observe("health, which does not authenticate",alice,Method.GET,"/api/v1/health",None,HostHeader,alice.cookie)
      (unknown,_,_)<-s.observe("unknown operation, which does not authenticate",alice,Method.POST,"/api/v1/nope",Some("{}"),HostHeader,OriginHeader,JsonBody,alice.cookie)
      (mcp,_,_)<-s.observe("mcp tools/list",alice,Method.POST,"/mcp",toolsList,HostHeader,JsonBody,"Accept"->"application/json, text/event-stream","Authorization"->("Bearer "+AliceToken))
      (live,_,_)<-s.observe("live upgrade",alice,Method.GET,"/api/v1/live",None,(Vector(HostHeader,OriginHeader,alice.cookie)++upgrade)*)
      (plain,_,_)<-s.observe("live without upgrade, refused before it authenticates",alice,Method.GET,"/api/v1/live",None,HostHeader,OriginHeader,alice.cookie)
      (account,_,_)<-s.observe("account",alice,Method.GET,"/api/account/v1",None,HostHeader,OriginHeader,alice.cookie)
      (issue,_,issued)<-s.observe("account token issue",alice,Method.POST,"/api/account/v1/tokens",Some("""{"name":"counted","scopes":["api"]}"""),HostHeader,OriginHeader,JsonBody,alice.cookie,actor)
      tokenId=parsed(issued).hcursor.downField("token").get[String]("id").fold(throw _,identity)
      (revoke,_,_)<-s.observe("account token revoke",alice,Method.POST,s"/api/account/v1/tokens/$tokenId/revoke",Some("{}"),HostHeader,OriginHeader,JsonBody,alice.cookie,actor)
      (logout,_,_)<-s.observe("account logout",alice,Method.POST,"/api/account/v1/logout",Some("{}"),HostHeader,OriginHeader,JsonBody,alice.cookie,actor)
      (login,signedIn,_)<-s.observe("account login",alice,Method.POST,"/api/account/v1/login",Some(s"""{"login":"alice","password":"$AlicePassword"}"""),HostHeader,OriginHeader,JsonBody)
      secret=signedIn.headers.get(CIString("Set-Cookie")).map(_.head.value).getOrElse(fail("session cookie expected")).takeWhile(_!=';').dropWhile(_!='=').drop(1)
      second<-s.browser(secret)
      (legacy,_,_)<-s.observe("legacy logout",second,Method.POST,"/api/v1/logout",Some("{}"),HostHeader,OriginHeader,JsonBody,second.cookie)
    } yield assertEquals(Vector(get,missing,stranger,retrieved,whoami,capabilities,analyze,health,unknown,mcp,live,plain,account,issue,revoke,logout,login,legacy).map(_.line),Vector(
      // before the body, after the body, before delivery
      Observed("get",200,"get",session,3),
      // before the body, after the body, then the log's own lookup: no result was delivered
      Observed("get of a missing item",404,"get",session,3),
      Observed("get with an unknown session",401,"get",None,2),
      Observed("retrieve",200,"retrieve",session,3),
      // no handler wait: the check that admitted the request, or its body, is the one before delivery
      Observed("whoami",200,"whoami",session,1),
      Observed("capabilities",200,"capabilities",session,1),
      Observed("query analysis",200,"analyze",session,2),
      Observed("health, which does not authenticate",200,"health",session,1),
      Observed("unknown operation, which does not authenticate",404,"unknown",session,1),
      Observed("mcp tools/list",200,"mcp",Some("alice"->"browser"),3),
      Observed("live upgrade",426,"live",session,1),
      Observed("live without upgrade, refused before it authenticates",426,"live",session,1),
      // before the read, the read's own transaction, before delivery
      Observed("account",200,"unknown",session,3),
      Observed("account token issue",200,"unknown",session,4),
      Observed("account token revoke",200,"unknown",session,4),
      // the session is gone when the row is written
      Observed("account logout",200,"logout",None,4),
      Observed("account login",200,"login",None,2),
      Observed("legacy logout",200,"logout",None,3)).map(_.line))
  }}
}
