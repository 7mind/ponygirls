package chronicle

import chronicle.api.*
import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import com.comcast.ip4s.*
import io.circe.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import org.http4s.{Http as _,Message as _,*}
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.ember.server.EmberServerBuilder
import org.typelevel.ci.CIString
import scala.concurrent.duration.*

class MessageContextHttpTest extends munit.FunSuite {
  private def rpc(id: UUID,messageId: String): Json = Json.obj("jsonrpc"->Json.fromString("2.0"),"id"->Json.fromInt(1),"method"->Json.fromString("tools/call"),"params"->Json.obj("name"->Json.fromString("read_message_context"),"arguments"->Json.obj("sessionId"->Json.fromString(id.toString),"view"->Wire.encode(ContentView.codecJson,ContentView(1,None)),"anchor"->Wire.encode(Span.codecJson,Span(messageId,0,1)),"beforeBytes"->Json.fromInt(0),"afterBytes"->Json.fromInt(4))))
  private def withHttp[A](f: ReadSourceFixture)(use: (org.http4s.client.Client[IO],String) => IO[A]): IO[A] = {
    val auth=new Auth(f.db,f.config); val protocol=new VersionedWire; val wire=new McpTestWire(protocol)
    (for {
      tools <- Resource.eval(McpTestFixtures.ordinaryTools)
      model <- Resource.eval(McpTestFixtures.model(_ => IO.raiseError(new AssertionError("HTTP context test must not call a provider"))))
      runs <- McpTestRuns.resource(tools,model,new PostgresRunAuthorization(f.db,auth),new SystemMcpRunClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO]),f.config.users.map(_.id).toSet,wire,IO(UUID.randomUUID()))
      controls <- BrowserControlAdmission.resource
      gate <- Resource.eval(Semaphore[IO](2))
      http=new Http(f.config,auth,f.app,f.archive,f.mcp,logstage.IzLogger(),Http.WebRoot(None),protocol,new BrowserRpc(f.app,runs,wire),controls)
      server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpWebSocketApp(ws => http.routes(ws,gate).orNotFound).build
      client <- EmberClientBuilder.default[IO].build
    } yield (client,s"http://127.0.0.1:${server.address.getPort}/mcp")).use { (client,url) => use(client,url) }
  }
  private def call(client: org.http4s.client.Client[IO],url: String,secret: String,request: Json): IO[(Status,Json)] = {
    val r=Request[IO](Method.POST,Uri.unsafeFromString(url)).withEntity(request.noSpaces).putHeaders(Header.Raw(CIString("Content-Type"),"application/json"),Header.Raw(CIString("Accept"),"application/json, text/event-stream"),Header.Raw(CIString("Authorization"),"Bearer "+secret))
    client.run(r).use(response => response.as[String].map(raw => (response.status,Wire.parse(raw)))).timeout(10.seconds)
  }
  List("token","sharing").foreach { change =>
    test(s"BG GoodCommunication regression: public HTTP context refuses $change revocation after source transfer before delivery") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
      val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val auth=new Auth(f.db,f.config)
      val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
      val group=UUID.randomUUID()
      if(change=="sharing") f.db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
      val tokenOwner=if(change=="token") owner else auth.browser(auth.login(LoginRequest("b","synthetic"))._2)
      val token=auth.mutate(tokenOwner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("context-http",List(Scope.Read)))).asInstanceOf[Result.Token].result
      val fired=new AtomicBoolean()
      f.probe.afterPayload(event => if(event.column=="source_value" && fired.compareAndSet(false,true)) {
        if(change=="token") auth.mutate(tokenOwner,ClientEnvelope(UUID.randomUUID(),Operation.RevokeToken(token.token.id)))
        else f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
        ()
      })
      val response=withHttp(f)((client,url) => call(client,url,token.secret.get,rpc(out.sessionId,original.messages.head.id))).unsafeRunSync()
      assert(fired.get(),"controlled source-transfer barrier was not reached")
      assertEquals(response._1,Status.Ok)
      assertEquals(response._2.hcursor.downField("result").get[Boolean]("isError").toOption,Some(true),"revoked source must not be delivered")
      val text=response._2.hcursor.downField("result").downField("content").downN(0).get[String]("text").toOption.get
      assertEquals(Wire.parse(text).hcursor.get[String]("code").toOption,Some(if(change=="token") "unauthorized" else "authorization-changed"))
      assert(!text.contains(original.messages.head.text))
    }}
  }
  test("BG GoodCommunication: public HTTP context rejects revoked bearer before any archive query") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val auth=new Auth(f.db,f.config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val token=auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("context-pre-revoked",List(Scope.Read)))).asInstanceOf[Result.Token].result
    auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.RevokeToken(token.token.id)))
    val response=withHttp(f)((client,url) => call(client,url,token.secret.get,rpc(out.sessionId,original.messages.head.id))).unsafeRunSync()
    assertEquals(response._1,Status.Unauthorized); assertEquals(f.probe.observations,Nil)
  }}
  test("BG GoodCommunication regression: public HTTP context framing overflow is a correlated MCP tool error") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val auth=new Auth(f.db,f.config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val token=auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("context-framing",List(Scope.Read)))).asInstanceOf[Result.Token].result
    // Corrupted metadata exceeds valid-ingest role bounds; exercise defensive public framing.
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_messages SET value=jsonb_set(value,'{role}',to_jsonb(repeat(chr(127),20000))) WHERE session_id=?",out.sessionId))
    val response=withHttp(f)((client,url) => call(client,url,token.secret.get,rpc(out.sessionId,original.messages.head.id))).unsafeRunSync()
    assertEquals(response._1,Status.Ok)
    assertEquals(response._2.hcursor.get[String]("jsonrpc").toOption,Some("2.0"))
    assertEquals(response._2.hcursor.get[Int]("id").toOption,Some(1))
    assertEquals(response._2.hcursor.downField("result").get[Boolean]("isError").toOption,Some(true))
    val text=response._2.hcursor.downField("result").downField("content").downN(0).get[String]("text").toOption.get
    assertEquals(Wire.parse(text).hcursor.get[String]("code").toOption,Some("read-budget"))
    assert(JsonUtf8Size(response._2)<MessageContextPolicy.maximumResultBytes)
  }}
  test("BG GoodCommunication: public HTTP context succeeds with Read-only bearer and exact source citation") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val auth=new Auth(f.db,f.config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val token=auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("context-success",List(Scope.Read)))).asInstanceOf[Result.Token].result
    val response=withHttp(f)((client,url) => call(client,url,token.secret.get,rpc(out.sessionId,original.messages.head.id))).unsafeRunSync()
    assertEquals(response._1,Status.Ok); assertEquals(response._2.hcursor.downField("result").get[Boolean]("isError").toOption,Some(false))
    val text=response._2.hcursor.downField("result").downField("content").downN(0).get[String]("text").toOption.get
    val result=Wire.decode(Result.codecJson,Wire.parse(text)).asInstanceOf[Result.MessageContext].result
    assertEquals(result.sessionId,out.sessionId); assertEquals(result.view,ContentView(1,None))
    assertEquals(result.excerpts.head.text,original.messages.head.text.take(5))
    assertEquals(result.excerpts.head.source,PassageSourceSpan(original.messages.head.id,0,0,5))
  }}
  test("BG GoodCommunication: context invocation without explicit fresh authority fails closed, old tool still succeeds") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original)
    val request=rpc(out.sessionId,original.messages.head.id)
    val response=f.mcp.handle(f.identity,request).unsafeRunSync().get
    assertEquals(response.hcursor.downField("result").get[Boolean]("isError").toOption,Some(true))
    assertEquals(f.probe.observations,Nil)
    val old=request.mapObject(_.add("params",Json.obj("name"->Json.fromString("whoami"),"arguments"->Json.obj())))
    assertEquals(f.mcp.handle(f.identity,old).unsafeRunSync().get.hcursor.downField("result").get[Boolean]("isError").toOption,Some(false))
  }}
  test("BG GoodCommunication: browser API1.9 context refreshes currentBrowser before and after archive materialization") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val auth=new Auth(f.db,f.config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val request=ClientEnvelope(UUID.randomUUID(),Operation.ReadMessageContext(out.sessionId,ContentView(1,None),Span(original.messages.head.id,0,1),0,4))
    val fired=new AtomicBoolean()
    f.probe.afterPayload(event => if(event.column=="source_value" && fired.compareAndSet(false,true)) auth.logout(owner))
    assertEquals(intercept[DomainError](f.app.operationVersion(owner,request,"1.9.0").unsafeRunSync()).code,"unauthorized")
    assert(fired.get())
    val before=f.probe.observations.collect { case SourceEvent.Query(sql,_) if sql.contains("ch_messages") => sql }
    assertEquals(intercept[DomainError](f.app.operationVersion(owner,request,"1.9.0").unsafeRunSync()).code,"unauthorized")
    assertEquals(f.probe.observations.collect { case SourceEvent.Query(sql,_) if sql.contains("ch_messages") => sql },before)
  }}

}
