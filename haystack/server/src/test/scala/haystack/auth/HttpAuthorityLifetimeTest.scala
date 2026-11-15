package haystack.auth

import cats.effect.{Deferred,IO}
import cats.syntax.all.*
import fs2.Stream
import haystack.{api,domain}
import haystack.application.ItemService
import haystack.http.{Http,LiveHub,Wire}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import java.util.concurrent.atomic.AtomicReference
import org.http4s.{Header,Method,Request,Status,Uri}
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.postgres.PostgresRetrieval
import com.comcast.ip4s.{Host,Port}
import scala.concurrent.duration.*

/** Regression: the body stream is held AFTER the production route captured its
  * initial auth. Revoking then releasing it must not read data or commit a write.
  * Real PG is mandatory; no automatic mocks or production credential reads.
  */
class HttpAuthorityLifetimeTest extends ContractSuite {
  import AuthFixtures.*
  private val key="authority:private"
  private val secret="synthetic-private-authority-canary"
  private def payload(route:String):io.circe.Json=route match{
    case "put"|"cookie-put"=>Wire.encode(api.PutRequest.codecJson,api.PutRequest(key,api.DocumentPayload(TestSupport.doc(secret)),0,java.util.UUID.fromString(TestSupport.requestId())))
    case "get"=>Wire.encode(api.GetRequest.codecJson,api.GetRequest(key,None))
    case "history"=>Wire.encode(api.HistoryRequest.codecJson,api.HistoryRequest(key))
    case "search"=>Wire.encode(api.SearchRequest.codecJson,api.SearchRequest("",None,20,None,api.SearchSort("key","asc")))
    case "complete"=>Wire.encode(api.QueryRequest.codecJson,api.QueryRequest("type:",5))
    case "mcp"=>io.circe.Json.obj("jsonrpc"->io.circe.Json.fromString("2.0"),"id"->io.circe.Json.fromInt(1),"method"->io.circe.Json.fromString("tools/call"),"params"->io.circe.Json.obj("name"->io.circe.Json.fromString("put"),"arguments"->io.circe.Json.obj("key"->io.circe.Json.fromString(key),"document_json"->io.circe.Json.fromString(TestSupport.doc(secret)),"expected_revision"->io.circe.Json.fromInt(0),"request_id"->io.circe.Json.fromString(TestSupport.requestId()))))
  }
  Vector("put","cookie-put","get","history","search","complete","mcp").foreach { route=>
    test("revocation after body admission denies actual PG route before dispatch: "+route) { directory { dir=>
      val configBefore=passwordConfig(dir);val current=new AtomicReference(Auth.load(configBefore))
      run(TestSupport.emptyDatabase.use { db=>for{
        _<-Migrations.initialize(db,TestSupport.Activity)
        accounts=new AccountService(db,()=>current.get())
        _<-accounts.reconcile(current.get())
        signed<-accounts.login("alice",AlicePassword,None)
        repo=new PostgresItemRepository(db)
        _<-if(Set("put","cookie-put","mcp").contains(route))IO.unit else repo.commit(TestSupport.op(key,document=TestSupport.doc(secret)),TestSupport.Bot,TestSupport.Now).void
        hub<-LiveHub.create
        service=new ItemService(repo,(_,_)=>IO.unit)
        retrieval=new HaystackRetrieval(db,ProjectionPolicy("authority-test",true,Vector.empty,4096),new PostgresRetrieval("authority-test",None),None,4)
        http=new Http(()=>current.get(),service,hub,None,retrieval,accounts)
        ws<-WebSocketBuilder2[IO]
        entered<-Deferred[IO,Unit];release<-Deferred[IO,Unit]
        bytes=payload(route).noSpaces.getBytes(java.nio.charset.StandardCharsets.UTF_8)
        body=Stream.eval(entered.complete(())).drain ++ Stream.eval(release.get).drain ++ Stream.emits(bytes).covary[IO]
        path=if(route=="mcp")"/mcp"else"/api/v1/"+(if(route=="cookie-put")"put"else route)
        credential=if(route=="cookie-put")Header.Raw(CIString("Cookie"),"__Host-haystack="+signed.session.secret)else Header.Raw(CIString("Authorization"),"Bearer "+AliceToken)
        request=Request[IO](Method.POST,Uri.unsafeFromString(path)).withBodyStream(body).putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Origin"),Secure),credential,Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Accept"),"application/json, text/event-stream"))
        fiber<-http.routes(ws).orNotFound(request).start
        _<-entered.get.timeout(2.seconds)
        _<-IO(current.set(Auth.load(configBefore.copy(users=Vector(configBefore.users(1))))))
        _<-release.complete(())
        response<-fiber.joinWithNever.timeout(5.seconds)
        text<-response.as[String]
        _=assertEquals(response.status,Status.Unauthorized)
        _=assert(!text.contains(secret));_=assert(response.headers.get(CIString("Set-Cookie")).isEmpty)
        item<-repo.current(domain.QualifiedId.decodeKey(key))
        _=assertEquals(item.isEmpty,Set("put","cookie-put","mcp").contains(route))
        count<-db.transaction { connection=>val statement=connection.createStatement();try{val rows=statement.executeQuery("SELECT count(*) FROM write_requests");try{rows.next();rows.getLong(1)}finally rows.close()}finally statement.close() }
        _=assertEquals(count,if(Set("put","cookie-put","mcp").contains(route))0L else 1L)
      }yield()})
    }}
  }
  test("real loopback non-upgrade426 responses never consume live session slots") { directory { dir=>
    val auth=Auth.load(passwordConfig(dir).copy(cookieSecure=false,allowedHosts=Vector("127.0.0.1"),allowedOrigins=Vector("http://allowed.test"),insecureHttpOrigins=Vector.empty))
    run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      accounts=new AccountService(db,()=>auth)
      _<-accounts.reconcile(auth)
      signed<-accounts.login("alice",AlicePassword,None)
      hub<-LiveHub.create
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("upgrade-test",true,Vector.empty,4096),new PostgresRetrieval("upgrade-test",None),None,4)
      http=new Http(()=>auth,new ItemService(new PostgresItemRepository(db),(_,_)=>IO.unit),hub,None,retrieval,accounts)
      _<-EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withShutdownTimeout(1.second).withHttpWebSocketApp(ws=>http.routes(ws).orNotFound).build.use { server=>
        EmberClientBuilder.default[IO].build.use { client=>
          val request=Request[IO](Method.GET,Uri.unsafeFromString(s"http://127.0.0.1:${server.address.getPort}/api/v1/live")).putHeaders(Header.Raw(CIString("Origin"),"http://allowed.test"),Header.Raw(CIString("Cookie"),"haystack-dev="+signed.session.secret))
          (1 to 8).toList.traverse_(_=>client.run(request).use(response=>IO(assertEquals(response.status,Status.UpgradeRequired)))) *>
          accounts.resolve(RequestHeaders("127.0.0.1",cookie=Vector("haystack-dev="+signed.session.secret))).flatMap(a=>hub.register(a).use(_=>IO.unit))
        }
      }
    }yield()})
  }}
  Vector("http","mcp").foreach { transport=>
    test("issued bearer revoked after PG read cannot deliver private response: "+transport) { directory { dir=>
      val auth=Auth.load(passwordConfig(dir))
      run(TestSupport.emptyDatabase.use { db=>for{
        _<-Migrations.initialize(db,TestSupport.Activity)
        accounts=new AccountService(db,()=>auth)
        _<-accounts.reconcile(auth)
        signed<-accounts.login("alice",AlicePassword,None)
        owner<-accounts.resolve(RequestHeaders("ts.test:8445",cookie=Vector("__Host-haystack="+signed.session.secret)))
        issued<-accounts.issue(owner,"held read",Vector("api"),Vector(ponygirls.auth.AccountJson.actor("alice")))
        repo=new PostgresItemRepository(db)
        _<-repo.commit(TestSupport.op(key,document=TestSupport.doc(secret)),TestSupport.Bot,TestSupport.Now)
        entered<-Deferred[IO,Unit];release<-Deferred[IO,Unit]
        delayed=new haystack.storage.ItemRepository {
          export repo.{revision,history,allCurrent,commit}
          def current(key:domain.ItemKey):IO[Option[domain.StoredItem]]=repo.current(key).flatTap(_=>entered.complete(()).void *> release.get)
        }
        hub<-LiveHub.create
        retrieval=new HaystackRetrieval(db,ProjectionPolicy("delivery-test",true,Vector.empty,4096),new PostgresRetrieval("delivery-test",None),None,4)
        http=new Http(()=>auth,new ItemService(delayed,(_,_)=>IO.unit),hub,None,retrieval,accounts)
        ws<-WebSocketBuilder2[IO]
        input=if(transport=="http")Wire.encode(api.GetRequest.codecJson,api.GetRequest(key,None))else io.circe.Json.obj("jsonrpc"->io.circe.Json.fromString("2.0"),"id"->io.circe.Json.fromInt(1),"method"->io.circe.Json.fromString("tools/call"),"params"->io.circe.Json.obj("name"->io.circe.Json.fromString("get"),"arguments"->io.circe.Json.obj("key"->io.circe.Json.fromString(key))))
        request=Request[IO](Method.POST,Uri.unsafeFromString(if(transport=="http")"/api/v1/get"else"/mcp")).withEntity(input.noSpaces).putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Authorization"),"Bearer "+issued.secret),Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Accept"),"application/json, text/event-stream"))
        fiber<-http.routes(ws).orNotFound(request).start
        _<-entered.get.timeout(2.seconds)
        _<-accounts.revoke(owner,issued.token.id,Vector(ponygirls.auth.AccountJson.actor("alice")))
        _<-release.complete(())
        response<-fiber.joinWithNever.timeout(5.seconds)
        text<-response.as[String]
        _=assertEquals(response.status,Status.Unauthorized)
        _=assert(!text.contains(secret))
      }yield()})
    }}
  }

}
