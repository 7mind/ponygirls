package haystack.http

import cats.effect.{IO,Resource}
import haystack.api
import haystack.application.ItemService
import haystack.auth.{AccountService,Auth}
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import haystack.storage.{ContractSuite,Migrations,PostgresItemRepository,TestSupport}
import io.circe.Json
import java.nio.file.{Files,Path}
import org.http4s.{Header,Method,Request,Status,Uri}
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval
import scala.jdk.CollectionConverters.*

/** Blackbox-GoodCommunication: the capability read, `/api/v1/retrieve` and the MCP `retrieve` tool through the production
  * routes of three servers over one database holding one unpublished item: lexical-only, configured, and configured with a
  * failing query embedding. Controlled embedding clients; no model or network. */
class RetrievalSurfaceTest extends ContractSuite {
  import haystack.auth.AuthFixtures.*
  private val space=EmbeddingSpace("synthetic-fixture","v1",3,false,"","","cosine")
  private val policy=ProjectionPolicy("retrieval-surface-test",true,Vector.empty,4096)
  private val vector=List(1.0,0.0,0.0)
  private def embedding(answer:IO[List[Double]]):EmbeddingClient=new EmbeddingClient {
    def documents(text:List[String]):IO[List[List[Double]]]=IO.pure(text.map(_=>vector))
    def query(text:String):IO[List[Double]]=answer
  }
  private val ProviderCanary="PROVIDER-CANARY-503"
  private val NotConfigured="semantic retrieval is not configured; lexical-only capability"
  private val EmbeddingFailed="query embedding failed"
  private def lexicalNotice(reason:String)=s"Hybrid search is not available on this server: $reason; showing lexical results"
  private val PendingLine="1 items are not yet indexed for semantic search; results may be incomplete"

  private final case class Servers(lexical:Http,configured:Http,failing:Http)
  private def temporary:Resource[IO,Path]=Resource.make(IO.blocking(Files.createTempDirectory("haystack-retrieval-surface-"))) { dir=>IO.blocking {
    val paths=Files.walk(dir);try paths.iterator.asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_)) finally paths.close()
  }}
  private def servers:Resource[IO,Servers]=for {
    dir<-temporary
    db<-TestSupport.emptyDatabase
    servers<-Resource.eval(for {
      _<-Migrations.initialize(db,TestSupport.Activity)
      auth=Auth.load(config(dir))
      hub<-LiveHub.create
      accounts=new AccountService(db,()=>auth,imperative)
      profiled=new PostgresRetrieval("haystack",Some(RetrievalProfile(space,policy.id)))
      configured=new HaystackRetrieval(db,policy,profiled,Some(embedding(IO.pure(vector))),4)
      failing=new HaystackRetrieval(db,policy,profiled,Some(embedding(IO.raiseError(RetrievalError("model-http",ProviderCanary)))),4)
      lexical=new HaystackRetrieval(db,policy,new PostgresRetrieval("haystack",None),None,4)
      repository=new PostgresItemRepository(db,Some(configured))
      _<-repository.initializeProjection()
      // Committed and queued, never published: no worker runs in this suite.
      _<-repository.commit(TestSupport.op("p:a",document=TestSupport.doc("harbour notes")),TestSupport.Bot,TestSupport.Now)
      service=new ItemService(repository,(_,_)=>IO.unit)
      http=(retrieval:HaystackRetrieval)=>new Http(()=>auth,service,hub,None,retrieval,accounts)
    } yield Servers(http(lexical),http(configured),http(failing)))
  } yield servers
  private val surface=new Fixture[Servers]("three retrieval servers over one database") {
    private var allocated=Option.empty[(Servers,IO[Unit])]
    def apply():Servers=allocated.fold(fail("servers were not started"))(_._1)
    override def beforeAll():Unit=allocated=Some(run(servers.allocated))
    override def afterAll():Unit=allocated.foreach(value=>run(value._2))
  }
  override def munitFixtures=List(surface)

  private def request(method:Method,path:String,body:Option[Json],bearer:Boolean):Request[IO]={
    val headers=List(Header.Raw(CIString("Host"),"ts.test:8445"),Header.Raw(CIString("Accept"),"application/json, text/event-stream"),Header.Raw(CIString("Content-Type"),"application/json"))++
      Option.when(bearer)(Header.Raw(CIString("Authorization"),"Bearer "+BotToken))
    val plain=Request[IO](method,Uri.unsafeFromString(path))
    headers.foldLeft(body.fold(plain)(json=>plain.withEntity(json.noSpaces)))((request,header)=>request.putHeaders(header))
  }
  private def call(http:Http,method:Method,path:String,body:Option[Json]=None,bearer:Boolean=true):(Status,Json)=run(for {
    ws<-WebSocketBuilder2[IO]
    response<-http.routes(ws).orNotFound(request(method,path,body,bearer))
    text<-response.as[String]
  } yield (response.status,io.circe.parser.parse(text).fold(throw _,identity)))
  private def modes(http:Http):List[api.RetrievalMode]={
    val (status,body)=call(http,Method.GET,"/api/v1/capabilities")
    assertEquals(status,Status.Ok)
    Wire.decode(api.RetrievalCapabilities.codecJson,body).modes
  }
  private def retrieve(http:Http,mode:api.RetrievalMode):(Status,Json)=
    call(http,Method.POST,"/api/v1/retrieve",Some(Wire.encode(api.RetrieveRequest.codecJson,api.RetrieveRequest("harbour",mode,Some("p"),false,0,10))))
  private def unavailable(result:(Status,Json)):String={
    assertEquals(result._1,Status.ServiceUnavailable)
    assert(!result._2.noSpaces.contains(ProviderCanary))
    val failure=Wire.decode(api.Failure.codecJson,result._2)
    assertEquals(failure.code,"unavailable")
    failure.message
  }
  private def mcp(http:Http,method:String,params:Json):Json={
    val (status,body)=call(http,Method.POST,"/mcp",Some(Json.obj("jsonrpc"->Json.fromString("2.0"),"id"->Json.fromInt(1),"method"->Json.fromString(method),"params"->params)))
    assertEquals(status,Status.Ok,body.noSpaces)
    body.hcursor.downField("result").focus.getOrElse(fail("JSON-RPC error: "+body.noSpaces))
  }
  private final case class Tool(error:Boolean,text:String,structured:Json) {
    def field(name:String):Json=structured.hcursor.downField(name).focus.getOrElse(Json.Null)
    def keys:List[String]=structured.hcursor.downField("sources").as[List[Json]].fold(throw _,identity).flatMap(_.hcursor.get[String]("key").toOption)
  }
  private def retrieveTool(http:Http,arguments:(String,Json)*):Tool={
    val result=mcp(http,"tools/call",Json.obj("name"->Json.fromString("retrieve"),"arguments"->Json.obj(("query"->Json.fromString("harbour"))+:("project"->Json.fromString("p"))+:arguments*)))
    val text=result.hcursor.downField("content").downArray.get[String]("text").fold(throw _,identity)
    Tool(result.hcursor.get[Boolean]("isError").getOrElse(false),text,result.hcursor.downField("structuredContent").focus.getOrElse(Json.Null))
  }

  test("capabilities: Lexical only without an embedding, all three modes with one; unauthenticated is 401") {
    assertEquals(modes(surface().lexical),List(api.RetrievalMode.Lexical))
    assertEquals(modes(surface().configured),List(api.RetrievalMode.Lexical,api.RetrievalMode.Semantic,api.RetrievalMode.Hybrid))
    val (status,body)=call(surface().configured,Method.GET,"/api/v1/capabilities",bearer=false)
    assertEquals((status,Wire.decode(api.Failure.codecJson,body).code),(Status.Unauthorized,"unauthorized"))
  }

  test("retrieve: pending passes through; not-configured and embedding-failed are 503 with fixed messages, never provider text") {
    val (status,body)=retrieve(surface().configured,api.RetrievalMode.Semantic)
    assertEquals(status,Status.Ok)
    val page=Wire.decode(api.RetrieveResult.codecJson,body)
    assertEquals((page.sources,page.pending),(Nil,1L))
    assertEquals(Wire.decode(api.RetrieveResult.codecJson,retrieve(surface().lexical,api.RetrievalMode.Lexical)._2).pending,0L)
    assertEquals(unavailable(retrieve(surface().lexical,api.RetrievalMode.Semantic)),NotConfigured)
    assertEquals(unavailable(retrieve(surface().failing,api.RetrievalMode.Hybrid)),EmbeddingFailed)
  }

  test("MCP: exactly four tools; retrieve defaults to hybrid when offered and declares pending items") {
    val tools=mcp(surface().configured,"tools/list",Json.obj()).hcursor.downField("tools").as[List[Json]].fold(throw _,identity)
    assertEquals(tools.flatMap(_.hcursor.get[String]("name").toOption),List("get","put","search","retrieve"))
    val defaulted=retrieveTool(surface().configured)
    assertEquals((defaulted.error,defaulted.field("requested_mode"),defaulted.field("effective_mode"),defaulted.field("notice")),(false,Json.Null,Json.fromString("hybrid"),Json.Null))
    assertEquals((defaulted.field("mode"),defaulted.field("pending")),(Json.fromString("Hybrid"),Json.fromString("1")))
    assert(defaulted.text.linesIterator.contains("mode: hybrid (default)"),defaulted.text)
    assert(defaulted.text.linesIterator.contains(PendingLine),defaulted.text)
  }

  test("MCP: retrieve falls back to lexical with a notice when hybrid is not offered or its query embedding fails; an explicit mode is never substituted") {
    for((http,reason)<-List(surface().lexical->NotConfigured,surface().failing->EmbeddingFailed)) {
      val fallback=retrieveTool(http)
      assertEquals((fallback.error,fallback.field("effective_mode"),fallback.field("notice")),(false,Json.fromString("lexical"),Json.fromString(lexicalNotice(reason))))
      assertEquals((fallback.keys,fallback.field("pending")),(List("p:a"),Json.fromString("0")))
      assert(fallback.text.linesIterator.contains("notice: "+lexicalNotice(reason)),fallback.text)
      assert(fallback.text.linesIterator.exists(_.startsWith("p:a r1 title /title score ")),fallback.text)
      assert(!fallback.text.contains("not yet indexed"),fallback.text)
    }
    for((http,reason)<-List(surface().lexical->NotConfigured,surface().failing->EmbeddingFailed)) {
      val refused=retrieveTool(http,"mode"->Json.fromString("semantic"))
      assertEquals((refused.error,refused.field("code"),refused.field("message")),(true,Json.fromString("unavailable"),Json.fromString(reason)))
      assertEquals(refused.text,"error unavailable: "+reason)
    }
    assertEquals(retrieveTool(surface().lexical,"mode"->Json.fromString("lexical")).field("notice"),Json.Null)
  }
}
