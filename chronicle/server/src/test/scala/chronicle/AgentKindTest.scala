package chronicle

import chronicle.api.*
import io.circe.Json

// Specified-origin classification contract, shared by archive and activity.
class AgentKindTest extends munit.FunSuite {
  test("BA: only subagentId presence classifies a source, across formats and misleading titles and parent-session links") {
    SourceFormat.all.foreach { format =>
      List(None,Some("child"),Some("main"),Some("")).foreach { subagent =>
        val original=Fixtures.snapshot()
        val raw=Json.obj("parentSession"->Json.fromString("parent"),"title"->Json.fromString("subagent worker")).noSpaces+"\n"
        val request=original.copy(source=original.source.copy(format=format,producerSessionId="subagent-looking-id",subagentId=subagent),metadata=original.metadata.copy(title=if(subagent.isEmpty) "subagent worker" else "main session",producer="subagent",model=Some("main"),tags=List("subagent")),files=List(RawFile("main.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
        assertEquals(AgentKind.classify(request.source),if(subagent.isDefined) AgentKind.Subagent else AgentKind.Main)
      }
    }
  }
  test("BA: no recorded subagent identity encodes as JSON null and classifies as main") {
    val encoded=Wire.encode(SourceIdentity.codecJson,Fixtures.snapshot().source)
    assertEquals(encoded.hcursor.get[Json]("subagentId"),Right(Json.Null))
    val source=Wire.decode(SourceIdentity.codecJson,encoded)
    assertEquals(source.subagentId,None)
    assertEquals(AgentKind.classify(source),AgentKind.Main)
    // The frozen wire codec still requires optional fields to be present (null).
    intercept[DomainError](Wire.decode(SourceIdentity.codecJson,encoded.mapObject(_.remove("subagentId"))))
  }
}
