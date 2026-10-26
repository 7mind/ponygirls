package chronicle
import chronicle.api.*
import baboon.runtime.shared.BaboonJsonCodec
import java.nio.file.{Files,Path}
class CodecFixtureTest extends munit.FunSuite {
  def check[A](name: String,codec: BaboonJsonCodec[A]): Unit = {
    val json=Wire.parse(Files.readString(Path.of(s"server/src/test/fixtures/$name.json")))
    assertEquals(Wire.encode(codec,Wire.decode(codec,json)),json)
  }
  test("BA: crosslanguage client fixture UUID ADT enum timestamp Unicode nullable") { check("client",ClientEnvelope.codecJson) }
  test("BA: crosslanguage chunk result UTF8 spans and score") { check("server",ServerEnvelope.codecJson) }
  test("BA: crosslanguage collector ingest fixture") { check("ingest",IngestRequest.codecJson) }
  test("BA: crosslanguage progress decimal i64 strings preserve exact sequence and payload sizes") { check("progress",CollectorProgressUpdate.codecJson) }
  test("Blackbox-Atomic: retained old exact search results upgrade through generated nested conversions") {
    val source=Fixtures.snapshot(); val id=java.util.UUID.randomUUID()
    val hit=SearchHit(SessionInfo(ContentView(1,None),id,"a",1,None,source.metadata,source.source,source.completion,false),Fragments.split(source.messages),0.5)
    val latest=SearchResult(List(hit),1,SearchCountScope.ExactMatches,None)
    val old=Wire.decode(chronicle.api.v1_0_0.SearchResult.codecJson,Wire.encode(SearchResult.codecJson,latest))
    assertEquals(chronicle.protocol.ProtocolConversions.up1_1_0.convert[chronicle.api.v1_1_0.SearchResult,SearchResult](chronicle.protocol.ProtocolConversions.up1_0_0.convert[chronicle.api.v1_0_0.SearchResult,chronicle.api.v1_1_0.SearchResult](old)),latest)
  }
}
