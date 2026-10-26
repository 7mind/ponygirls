package chronicle

import chronicle.api.*
import io.circe.Json
import java.time.Instant
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

class McpTestWireTest extends munit.FunSuite {
  private val protocol=new VersionedWire(new chronicle.protocol.ProtocolConversions)
  private val wire=new McpTestWire(protocol)
  private val requestId=UUID.randomUUID()
  private val instance=UUID.randomUUID()
  private val run=UUID.randomUUID()
  private val now=Instant.parse("2026-01-01T00:00:00.123456789Z")
  private def snapshot(text: String,state: McpRunState): McpRunSnapshot = McpRunSnapshot(instance,run,state,now,List(McpRunEvent(Long.MaxValue,now,McpRunItem.Response(Int.MaxValue,Int.MaxValue,text))),Long.MaxValue,true,Some(McpRunFailure("sanitized","fixed failure")))

  test("BA: every state, item, timestamp, counter, and failure uses the exact API1.4 shape") {
    McpRunState.values.foreach { state =>
      val domain=snapshot("\u0085\"\\🙂",state).copy(events=List(
        McpRunEvent(1L,now,McpRunItem.ToolCall("call","provided-tool",0,1,"{\"q\":\"🙂\"}")),
        McpRunEvent(2L,now,McpRunItem.ToolResult("call",0,1,"{}")),
        McpRunEvent(Long.MaxValue,now,McpRunItem.Response(Int.MaxValue,Int.MaxValue,"\u0085\"\\🙂"))))
      val dto=wire.snapshot(domain).result
      assertEquals(dto.state.toString,state.toString)
      assertEquals(dto.observedAt,now.toString)
      assertEquals(dto.events.head.item,McpTestItem.ToolCall("call","provided-tool",0,1,"{\"q\":\"🙂\"}"))
      assertEquals(dto.events(1).item,McpTestItem.ToolResult("call",0,1,"{}"))
      assertEquals(dto.lastSequence,Long.MaxValue)
      assertEquals(dto.failure,Some(Failure("sanitized","fixed failure")))
      val encoded=protocol.encodeServer("1.4.0",ServerEnvelope(requestId,wire.snapshot(domain)))
      assertEquals(wire.bytes(domain),encoded.noSpaces.getBytes(UTF_8).length.toLong)
      assertEquals(Wire.decode(ServerEnvelope.codecJson,encoded).result,wire.snapshot(domain))
    }
  }

  test("BA: exact full Result plus ServerEnvelope payload admits48KiB and rejects the next byte") {
    val empty=snapshot("",McpRunState.Failed)
    val overhead=wire.bytes(empty).toInt
    val exact=empty.copy(events=List(McpRunEvent(Long.MaxValue,now,McpRunItem.Response(Int.MaxValue,Int.MaxValue,"x"*(McpRunLimits.pageBytes-overhead)))))
    val json=wire.encode(ServerEnvelope(requestId,wire.snapshot(exact)))
    assertEquals(json.noSpaces.getBytes(UTF_8).length,McpRunLimits.pageBytes)
    assertEquals(wire.bytes(exact),McpRunLimits.pageBytes.toLong)
    val excessive=exact.copy(events=List(McpRunEvent(Long.MaxValue,now,McpRunItem.Response(Int.MaxValue,Int.MaxValue,"x"*(McpRunLimits.pageBytes-overhead+1)))))
    assertEquals(intercept[DomainError](wire.encode(ServerEnvelope(requestId,wire.snapshot(excessive)))).code,"mcp-page-invariant")
  }

  test("BA: catalog maps injected definitions/model/limits without a copied registry or truncation") {
    val tools=List("provided_one","provided_two","provided_three").map(name => McpRunToolDefinition(name,"provided \u0085 description",Json.obj("type"->Json.fromString("object"),"properties"->Json.obj()),true))
    val domain=McpRunCatalog(instance,McpRunModel("configured-model","configured-revision",65536,"max"),tools)
    val dto=wire.catalog(domain).result
    assertEquals(dto.tools.map(_.name),tools.map(_.name))
    assertEquals(dto.tools.map(_.inputSchemaJson),tools.map(_.inputSchemaJson.noSpaces))
    assertEquals(dto.modelRevision,"configured-revision")
    assertEquals(dto.maximumOutputTokens,65536)
    assertEquals(dto.reasoningPolicy,"max")
    assertEquals(dto.limits,McpTestLimits(4,8,16384,65536,131072,524288,1048576,256,49152,900,600))
    val oversized=domain.copy(tools=List(tools.head.copy(description="\u0085"*10000)))
    assertEquals(intercept[DomainError](wire.encode(ServerEnvelope(requestId,wire.catalog(oversized)))).code,"mcp-catalog-limit")
    assertEquals(wire.catalog(oversized).result.tools.head.description.length,10000)
  }
}
