package haystack.auth

import cats.effect.IO
import haystack.{api,domain}
import haystack.application.ItemService
import haystack.http.{Http,LiveHub,Wire}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import org.http4s.{Header,Method,Request,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.postgres.PostgresRetrieval

/** Actual current generated request/response through HTTP routes, with the
  * production JDBC adapter. Boundary failures must not acquire suggestions.
  */
class QueryRequestHttpTest extends ContractSuite {
  import AuthFixtures.*
  private def request(query:String,caret:Int,path:String="complete",expected:Status,code:Option[String]=None):Unit=directory { dir=>
    val auth=Auth.load(config(dir));run(TestSupport.emptyDatabase.use { db=>for{
      _<-Migrations.initialize(db,TestSupport.Activity)
      hub<-LiveHub.create
      repo=new PostgresItemRepository(db)
      service=new ItemService(repo,(_,_)=>IO.unit)
      retrieval=new HaystackRetrieval(db,ProjectionPolicy("request-boundary-test",true,Vector.empty,4096),new PostgresRetrieval("query-request",None),None,4)
      http=new Http(()=>auth,service,hub,None,retrieval)
      ws<-WebSocketBuilder2[IO]
      route=if(path=="complete")"/api/v1/complete"else"/api/v1/query/analyze"
      input=Request[IO](Method.POST,Uri.unsafeFromString(route)).withEntity(Wire.encode(api.QueryRequest.codecJson,api.QueryRequest(query,caret)).noSpaces).putHeaders(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Authorization"),"Bearer "+AliceToken),Header.Raw(CIString("Content-Type"),"application/json"))
      response<-http.routes(ws).orNotFound(input)
      body<-response.as[String]
      _=assertEquals(response.status,expected)
      _=code.foreach { category=>val failure=Wire.decode(api.Failure.codecJson,Wire.parse(body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));assertEquals(failure.code,category) }
    }yield()})
  }
  test("completion rejects4097 UTF16 query units even when caret only requests its short prefix") { request("sta"+" "*4094,3,expected=Status.BadRequest,code=Some("invalid-query")) }
  test("completion rejects UTF16 caret between a supplementary scalar's surrogate halves") { request("a😀b",2,expected=Status.BadRequest,code=Some("bad-envelope")) }
  test("completion accepts exactly4096 UTF16 units") { request(" "*4093+"sta",4096,expected=Status.Ok) }
  test("completion accepts scalar-safe caret before a supplementary scalar") { request("sta 😀",4,expected=Status.Ok) }
  test("completion accepts scalar-safe caret after a supplementary scalar") { request("😀 sta",6,expected=Status.Ok) }
}
