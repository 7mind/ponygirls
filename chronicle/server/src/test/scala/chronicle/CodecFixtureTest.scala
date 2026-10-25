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
  test("Blackbox-Atomic: retained old exact search results upgrade through generated nested conversions") {
    val conversions=new baboon.runtime.shared.AbstractBaboonConversions { def versionTo="1.1.0"; def versionsFrom=List("1.0.0") }
    conversions.register(Convert__SearchHit__From__1_0_0)
    conversions.register(Convert__SessionInfo__From__1_0_0)
    conversions.register(Convert__ContentView__From__1_0_0)
    conversions.register(Convert__Metadata__From__1_0_0)
    conversions.register(Convert__SourceIdentity__From__1_0_0)
    conversions.register(Convert__SourceFormat__From__1_0_0)
    conversions.register(Convert__Completion__From__1_0_0)
    conversions.register(Convert__Chunk__From__1_0_0)
    conversions.register(Convert__Span__From__1_0_0)
    conversions.register(new SearchResultFromV1)
    val source=Fixtures.snapshot(); val id=java.util.UUID.randomUUID()
    val hit=SearchHit(SessionInfo(ContentView(1,None),id,"a",1,None,source.metadata,source.source,source.completion,false),Fragments.split(source.messages),0.5)
    val latest=SearchResult(List(hit),1,SearchCountScope.ExactMatches,None)
    val old=Wire.decode(chronicle.api.v1_0_0.SearchResult.codecJson,Wire.encode(SearchResult.codecJson,latest))
    assertEquals(conversions.convertWithContext[Unit,chronicle.api.v1_0_0.SearchResult,SearchResult](None,old),latest)
  }
}
