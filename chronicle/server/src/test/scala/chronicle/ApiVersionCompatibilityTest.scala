package chronicle

import chronicle.api.*
import java.util.UUID

class ApiVersionCompatibilityTest extends munit.FunSuite {
  private val protocol=new VersionedWire
  private val id=UUID.fromString("00000000-0000-4000-8000-000000000001")
  private val request=ClientEnvelope(id,Operation.ReadMessageContext(id,ContentView(1,Some(id)),Span("message",0,4),1024,2048))
  private val response=ServerEnvelope(id,Result.MessageContext(MessageContextResult(id,ContentView(1,Some(id)),PassageSourceSpan("message",0,0,4),List(ContextExcerpt(PassageSourceSpan("message",0,0,4),"user","text")),None,None)))

  test("BG specified: sole API accepts the current request and response without projection") {
    assertEquals(protocol.decodeClient("1.9.0",Wire.encode(ClientEnvelope.codecJson,request)),request)
    assertEquals(protocol.encodeServer("1.9.0",response),Wire.encode(ServerEnvelope.codecJson,response))
    assertEquals(Wire.decode(ServerEnvelope.codecJson,protocol.encodeServer("1.9.0",response)),response)
  }

  test("BG specified: every removed API and a future API reject requests and responses explicitly") {
    ((0 to 8).map(minor => s"1.$minor.0") ++ List("2.0.0","")).foreach { version =>
      assertEquals(intercept[DomainError](protocol.decodeClient(version,Wire.encode(ClientEnvelope.codecJson,request))).code,"version-mismatch")
      assertEquals(intercept[DomainError](protocol.encodeServer(version,response)).code,"version-mismatch")
    }
  }

  test("BA specified: unsupported version rejection precedes payload decoding") {
    assertEquals(intercept[DomainError](protocol.decodeClient("1.8.0",io.circe.Json.Null)).code,"version-mismatch")
    assertEquals(intercept[DomainError](protocol.decodeClient("1.9.0",io.circe.Json.Null)).code,"invalid")
  }
}
