package haystack.auth

import cats.effect.IO
import haystack.{api}
import haystack.application.ItemService
import haystack.http.{Http,LiveHub,Wire}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import org.http4s.{Header,Method,Request,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.postgres.PostgresRetrieval

/** Behavioral Blackbox Good-Communication: production routes and owned PG. */
class AccountHttpTest extends ContractSuite {
  import AuthFixtures.*
  test("legacy token login cannot install an API bearer as a browser session") { directory { dir=>
    val auth=Auth.load(config(dir))
    run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("account-test",true,Vector.empty,4096),new PostgresRetrieval("account-test",None),None,4)
      http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,new AccountService(db,()=>auth))
      ws<-WebSocketBuilder2[IO]
      request=Request[IO](Method.POST,Uri.unsafeFromString("/api/v1/login")).withEntity(Wire.encode(api.LoginRequest.codecJson,api.LoginRequest(AliceToken)).noSpaces).putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Origin"),Secure),Header.Raw(CIString("Content-Type"),"application/json"))
      response<-http.routes(ws).orNotFound(request)
      _=assertEquals(response.status,Status.Unauthorized)
      _=assert(response.headers.get(CIString("Set-Cookie")).isEmpty)
    }yield()})
  }}
  test("account token mint rejects stale actor even when a different browser cookie is valid") { directory { dir=>
    val cfg=passwordConfig(dir)
    val auth=Auth.load(cfg.copy(users=cfg.users :+ UserConfig("bob","human","Bob",Vector.empty,Some("bob"),cfg.users.head.passwordHashFile,true)))
    run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      accounts=new AccountService(db,()=>auth)
      _<-accounts.reconcile(auth)
      signed<-accounts.login("bob",AlicePassword,None)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("actor-test",true,Vector.empty,4096),new PostgresRetrieval("actor-test",None),None,4)
      http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,accounts)
      ws<-WebSocketBuilder2[IO]
      request=Request[IO](Method.POST,Uri.unsafeFromString("/api/account/v1/tokens")).withEntity("{\"name\":\"wrong-owner\",\"scopes\":[\"api\"]}").putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Origin"),Secure),Header.Raw(CIString("Cookie"),"__Host-haystack="+signed.session.secret),Header.Raw(CIString("X-Account-Actor"),ponygirls.auth.AccountJson.actor("alice")),Header.Raw(CIString("Content-Type"),"application/json"))
      response<-http.routes(ws).orNotFound(request)
      _=assertEquals(response.status,Status.Conflict)
      duplicate=request.withHeaders(org.http4s.Headers(request.headers.headers :+ Header.Raw(CIString("X-Account-Actor"),ponygirls.auth.AccountJson.actor("bob"))))
      duplicateResponse<-http.routes(ws).orNotFound(duplicate)
      _=assertEquals(duplicateResponse.status,Status.BadRequest)
      current<-accounts.resolve(RequestHeaders("ts.test:8445",cookie=Vector("__Host-haystack="+signed.session.secret)))
      view<-accounts.account(current)
      _=assertEquals(view.tokens,Vector.empty)
    }yield()})
  }}

}
