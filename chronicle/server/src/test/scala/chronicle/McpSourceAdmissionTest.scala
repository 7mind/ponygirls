package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

class McpSourceAdmissionTest extends munit.FunSuite {
  private val maximum=64L*1024
  private val vector=ProblemPublicationFixtures.vector
  private def string(value: String): Json=Json.fromString(value)
  private def args(id: UUID): Json=Json.obj("sessionId"->string(id.toString))
  private def limited(f: ReadSourceFixture,bytes: Long): ReadAdmission = f.probe.admission(ReadAdmission.limited(bytes).unsafeRunSync(),_ => ())
  private def invoke(f: ReadSourceFixture,name: String,arguments: Json,admission: ReadAdmission): Json=f.tools.invoke(f.access,name,arguments,admission).unsafeRunSync()
  private def payloads(f: ReadSourceFixture): List[SourceEvent.Payload]=f.probe.observations.collect { case value: SourceEvent.Payload => value }
  private def seed(f: ReadSourceFixture): IngestReceipt=f.publish(Fixtures.snapshot(),"archive synthetic","archive",Nil,Nil)
  private def budgetFailure(effect: => Json): Unit=assertEquals(intercept[DomainError](effect).code,"read-budget")
  private def requestWithField(field: String,huge: String): IngestRequest = {
    val original=Fixtures.snapshot()
    val message=original.messages.head
    if(field=="timestamp") original.copy(messages=List(message.copy(timestamp=Some(huge)))) else {
      val raw=original.files.head.content+Json.obj("id"->string(huge)).noSpaces+"\n"
      original.copy(messages=List(message.copy(parentId=Some(huge))),files=List(original.files.head.copy(content=raw,sha256=Wire.hash(raw))),digest=Wire.hash(raw))
    }
  }
  test("BG GoodCommunication: live adapter shares all eight actual definitions, parser and successful HTTP tool content") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=seed(f)
    val listed=f.mcp.tools.asArray.get
    assertEquals(f.tools.definitions.size,8)
    f.tools.definitions.foreach { definition =>
      val tool=listed.find(_.hcursor.get[String]("name").contains(definition.name)).get
      assertEquals(tool.hcursor.get[String]("description").toOption,Some(definition.description))
      assertEquals(tool.hcursor.downField("inputSchema").focus,Some(definition.inputSchemaJson))
      assertEquals(tool.hcursor.downField("annotations").get[Boolean]("readOnlyHint").toOption,Some(definition.readOnly))
    }
    val calls=List("search_sessions"->Json.obj("query"->string("archive"),"mode"->string("lexical")),"get_session"->args(receipt.sessionId),
      "get_chunks"->args(receipt.sessionId),"get_messages"->args(receipt.sessionId),"related_sessions"->args(receipt.sessionId),"list_facets"->Json.obj(),"ingest_status"->Json.obj(),"whoami"->Json.obj())
    calls.foreach { (name,arguments) =>
      val actual=invoke(f,name,arguments,limited(f,maximum))
      val rpc=Json.obj("jsonrpc"->string("2.0"),"id"->Json.fromInt(1),"method"->string("tools/call"),"params"->Json.obj("name"->string(name),"arguments"->arguments))
      val http=f.mcp.handle(f.identity,rpc).unsafeRunSync().get
      assertEquals(http.hcursor.downField("result").focus,Some(actual)); assertEquals(actual.hcursor.get[Boolean]("isError").toOption,Some(false))
    }
    f.probe.observations.collect { case SourceEvent.Query(_,columns) => columns }.foreach { columns =>
      assert(!columns.exists(Set("snapshot","document","embedding")))
    }
    assert(f.probe.observations.collect { case SourceEvent.Closed(_,exhausted) => exhausted }.forall(identity))
  }}
  List("parentId","timestamp").foreach { field =>
    test(s"WG GoodCommunication: whole normalized message $field is admitted before payload getString, even when text is tiny") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
      val receipt=f.archive.ingest("a",requestWithField(field,"\u0080\"\\"*50000))
      budgetFailure(invoke(f,"get_messages",args(receipt.sessionId),limited(f,maximum)))
      assertEquals(payloads(f),Nil)
    }}
  }
  test("WG GoodCommunication: session preflight aggregates metadata and first chunks before either payload is decoded") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val receipt=f.publish(original.copy(metadata=original.metadata.copy(title="m"*40000)),"tiny","s"*40000,Nil,Nil)
    budgetFailure(invoke(f,"get_session",args(receipt.sessionId),limited(f,maximum)))
    assertEquals(payloads(f),Nil)
  }}
  List("summary","tags","spans").foreach { field =>
    test(s"WG GoodCommunication: complete chunk $field, not just source text, is sized before payload fetch") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
      val huge="\u0080\"\\"*50000
      val receipt=f.publish(Fixtures.snapshot(),"tiny",if(field=="summary") huge else "archive",if(field=="tags") List(huge) else Nil,
        if(field=="spans") List.fill(5000)(Span("message"*30,0,1)) else Nil)
      budgetFailure(invoke(f,"get_chunks",args(receipt.sessionId),limited(f,maximum)))
      assertEquals(payloads(f),Nil)
    }}
  }
  test("WG GoodCommunication: full selected search metadata is rejected before any archive hit payload") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); seed(f)
    val receipt=f.publish(original.copy(metadata=original.metadata.copy(title="\u0080"*50000)),"archive","archive",Nil,Nil)
    budgetFailure(invoke(f,"search_sessions",Json.obj("query"->string("archive"),"mode"->string("lexical")),limited(f,maximum)))
    assertEquals(payloads(f),Nil)
    val pages=f.probe.observations.collect { case SourceEvent.Query(sql,columns) if sql.contains("result_sessions AS") => columns.toSet }
    assertEquals(pages,List(Set("total","id","generation","session_id","revision","score")))
  }}
  test("WG GoodCommunication: job errors are measured without returning unused profile or lease fields") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=f.archive.ingest("a",Fixtures.snapshot())
    f.db.transaction(c => Sql.exec(c,"UPDATE ch_jobs SET error=? WHERE id=?","\u0080"*50000,receipt.jobId))
    budgetFailure(invoke(f,"ingest_status",Json.obj(),limited(f,maximum)))
    assertEquals(payloads(f),Nil)
  }}
  test("WG GoodCommunication: facet cursor sends only a numeric header before over-budget selection rejection") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); f.publish(original.copy(metadata=original.metadata.copy(project=Some("\u0080"*50000))),"archive","archive",Nil,Nil)
    budgetFailure(invoke(f,"list_facets",Json.obj(),limited(f,maximum)))
    assertEquals(payloads(f),Nil)
    val queries=f.probe.observations.collect { case SourceEvent.Query(sql,_) => sql }
    assert(queries.contains("FETCH FORWARD 1 FROM ch_mcp_selected_sources"))
    assert(!queries.exists(_.startsWith("FETCH FORWARD 300")))
  }}
  test("WG GoodCommunication: related seed and selected search results share one cumulative admission") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val first=f.publish(Fixtures.snapshot(),"archive "+"a"*30000,"archive",Nil,Nil)
    f.publish(Fixtures.snapshot(),"archive "+"b"*30000,"archive",Nil,Nil)
    budgetFailure(invoke(f,"related_sessions",args(first.sessionId),limited(f,maximum)))
    val reads=payloads(f)
    assertEquals(reads.map(_.sql).distinct.size,1)
    assert(reads.head.sql.startsWith("SELECT value FROM ch_chunks"))
    assertEquals(reads.count(_.column=="value"),1)
  }}
  test("BG GoodCommunication: exact selected logical UTF8 cap succeeds and N-1 fails for escaped Unicode; unselected giant rows do not charge") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val receipt=f.archive.ingest("a",original.copy(messages=original.messages.map(_.copy(text="\u0001\u0080🙂\"\\"*100))))
    f.archive.ingest("a",Fixtures.snapshot().copy(metadata=original.metadata.copy(title="z"*100000)))
    val total=new AtomicLong()
    val recorder=f.probe.admission(new ReadAdmission { def consume(bytes: Long): Unit={ total.addAndGet(bytes); () } },_ => ())
    val expected=invoke(f,"get_messages",args(receipt.sessionId),recorder)
    assert(total.get()>0 && total.get()<maximum)
    assertEquals(invoke(f,"get_messages",args(receipt.sessionId),limited(f,total.get())),expected)
    budgetFailure(invoke(f,"get_messages",args(receipt.sessionId),limited(f,total.get()-1)))
    val empty=args(receipt.sessionId).mapObject(_.add("offset",Json.fromInt(Int.MaxValue)))
    budgetFailure(invoke(f,"get_messages",empty,limited(f,0)))
    assertEquals(invoke(f,"get_messages",empty,limited(f,maximum)).hcursor.get[Boolean]("isError").toOption,Some(false))
  }}
  test("BG GoodCommunication: oversized already-materialized identity is counted without claiming pre-Auth database protection") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val access=new McpRunAccess { def fresh: IO[Identity]=IO.pure(f.identity.copy(user=f.identity.user.copy(login="\u0080"*50000))) }
    assertEquals(intercept[DomainError](f.tools.invoke(access,"whoami",Json.obj(),limited(f,maximum)).unsafeRunSync()).code,"read-budget")
    assertEquals(f.probe.observations.collect { case event: SourceEvent.Query => event },Nil)
  }}
  test("BG GoodCommunication: unknown tools/writes/arguments and malformed bounds fail terminally without source payloads") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val receipt=seed(f)
    val calls=List("delete_session"->args(receipt.sessionId),"get_chunks"->args(receipt.sessionId).mapObject(_.add("extra",Json.True)),
      "get_messages"->args(receipt.sessionId).mapObject(_.add("limit",Json.fromInt(101))),"get_chunks"->args(receipt.sessionId).mapObject(_.add("offset",Json.fromInt(-1))),
      "search_sessions"->Json.obj("query"->string("archive"),"mode"->string("semantic"),"limit"->Json.fromInt(0)))
    calls.foreach { (name,arguments) => assertEquals(intercept[DomainError](invoke(f,name,arguments,limited(f,maximum))).code,"invalid") }
    assertEquals(payloads(f),Nil)
  }}
}
