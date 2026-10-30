package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import chronicle.api.*
import io.circe.Json

class McpMessageContextTest extends munit.FunSuite {
  private def s(value: String): Json=Json.fromString(value)
  private def seed(f: ReadSourceFixture): IngestReceipt = {
    val request=Fixtures.snapshot()
    val message=request.messages.head
    val text="x"*70000+"contextneedle"+"y"*70000
    f.publish(request.copy(messages=List(message.copy(text=text))),"contextneedle","contextneedle",Nil,List(Span(message.id,70000,70013)))
  }
  private def invoke(f: ReadSourceFixture,name: String,args: Json): Json =
    f.tools.invoke(f.access,name,args,ReadAdmission.limited(64L*1024).unsafeRunSync()).unsafeRunSync()
  test("BG GoodCommunication regression: whole-message limit one remains over the source budget") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val receipt=seed(f)
    assertEquals(intercept[DomainError](invoke(f,"get_messages",Json.obj("sessionId"->s(receipt.sessionId.toString),"limit"->Json.fromInt(1)))).code,"read-budget")
  }}
  test("BG GoodCommunication specified: search hit anchors roundtrip through advertised bounded context tool") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val receipt=seed(f)
    val search=invoke(f,"search_sessions",Json.obj("query"->s("contextneedle"),"mode"->s("lexical")))
    val result=Wire.decode(Result.codecJson,Wire.parse(search.hcursor.downField("content").downN(0).get[String]("text").toOption.get)).asInstanceOf[Result.Search].result
    val hit=result.hits.find(_.session.id==receipt.sessionId).get
    assert(f.tools.definitions.exists(_.name=="read_message_context"),"missing read_message_context in MCP catalog")
    val response=invoke(f,"read_message_context",Json.obj("sessionId"->s(hit.session.id.toString),"view"->Wire.encode(ContentView.codecJson,hit.session.view),"anchor"->Wire.encode(Span.codecJson,hit.chunks.head.spans.head),"beforeBytes"->Json.fromInt(4),"afterBytes"->Json.fromInt(4)))
    assertEquals(response.hcursor.get[Boolean]("isError").toOption,Some(false))
    assert(response.noSpaces.contains("contextneedle"))
  }}
  test("BG GoodCommunication: context parser requires exact nested view/anchor and both byte budgets") { ReadSourceFixture.withFixture(_ => IO.pure(ProblemPublicationFixtures.vector)) { f =>
    val receipt=seed(f); val anchor=Span(Fixtures.snapshot().messages.head.id,70000,70013)
    val valid=Json.obj("sessionId"->s(receipt.sessionId.toString),"view"->Wire.encode(ContentView.codecJson,ContentView(1,None)),"anchor"->Wire.encode(Span.codecJson,anchor),"beforeBytes"->Json.fromInt(4),"afterBytes"->Json.fromInt(4))
    val invalid=List(
      valid.mapObject(_.remove("beforeBytes")),valid.mapObject(_.remove("afterBytes")),
      valid.mapObject(_.add("revision",Json.fromInt(1))),
      valid.mapObject(_.add("view",Json.obj("revision"->Json.fromInt(1)))),
      valid.mapObject(_.add("anchor",Wire.encode(Span.codecJson,anchor).mapObject(_.add("position",Json.fromInt(0))))),
      valid.mapObject(_.add("beforeBytes",Json.Null)),valid.mapObject(_.add("afterBytes",Json.fromInt(3))))
    invalid.foreach(args => assertEquals(intercept[DomainError](invoke(f,"read_message_context",args)).code,"invalid"))
    assertEquals(f.probe.observations.collect { case event: SourceEvent.Payload => event },Nil)
    assertEquals(invoke(f,"read_message_context",valid).hcursor.get[Boolean]("isError").toOption,Some(false))
  }}

}
