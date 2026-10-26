package chronicle
import chronicle.api.*
import baboon.runtime.shared.BaboonJsonCodec
import java.nio.file.{Files,Path}
class CodecFixtureTest extends munit.FunSuite {
  private val conversions=new chronicle.protocol.ProtocolConversions
  def check[A](name: String,codec: BaboonJsonCodec[A]): Unit = {
    val raw=Files.readString(Path.of(s"server/src/test/fixtures/$name.json")).trim
    val json=Wire.parse(raw)
    assertEquals(Wire.encode(codec,Wire.decode(codec,json)).noSpaces,json.noSpaces,"crosslanguage compact golden bytes")
  }
  test("BA: crosslanguage client fixture UUID ADT enum timestamp Unicode nullable") { check("client",ClientEnvelope.codecJson) }
  test("BA: crosslanguage chunk result UTF8 spans and score") { check("server",ServerEnvelope.codecJson) }
  test("BA: crosslanguage collector ingest fixture") { check("ingest",IngestRequest.codecJson) }
  test("BA: crosslanguage progress decimal i64 strings preserve exact sequence and payload sizes") { check("progress",CollectorProgressUpdate.codecJson) }
  test("BA specified: retained generated codecs preserve existing golden bytes in every published version") {
    List[BaboonJsonCodec[?]](chronicle.api.v1_0_0.ClientEnvelope.codecJson,chronicle.api.v1_1_0.ClientEnvelope.codecJson,chronicle.api.v1_2_0.ClientEnvelope.codecJson,chronicle.api.v1_3_0.ClientEnvelope.codecJson).foreach(codec => check("client",codec))
    List[BaboonJsonCodec[?]](chronicle.api.v1_0_0.ServerEnvelope.codecJson,chronicle.api.v1_1_0.ServerEnvelope.codecJson,chronicle.api.v1_2_0.ServerEnvelope.codecJson,chronicle.api.v1_3_0.ServerEnvelope.codecJson).foreach(codec => check("server",codec))
    List[BaboonJsonCodec[?]](chronicle.api.v1_0_0.IngestRequest.codecJson,chronicle.api.v1_1_0.IngestRequest.codecJson,chronicle.api.v1_2_0.IngestRequest.codecJson,chronicle.api.v1_3_0.IngestRequest.codecJson).foreach(codec => check("ingest",codec))
    List[BaboonJsonCodec[?]](chronicle.api.v1_2_0.CollectorProgressUpdate.codecJson,chronicle.api.v1_3_0.CollectorProgressUpdate.codecJson).foreach(codec => check("progress",codec))
  }
  private def checkList[A](name: String,codec: BaboonJsonCodec[A]): Vector[A] = {
    val raw=Files.readString(Path.of(s"server/src/test/fixtures/$name.json")).trim
    val fixtures=Wire.parse(raw).asArray.getOrElse(fail("expected codec fixture array"))
    val values=fixtures.map(json => Wire.decode(codec,json))
    assertEquals(io.circe.Json.fromValues(values.map(value => Wire.encode(codec,value))).noSpaces,raw,"crosslanguage golden bytes")
    values
  }
  test("BA specified: API1.4 client fixtures cover every additive branch and exact i64 sequence") {
    val envelopes=checkList("api14-clients",ClientEnvelope.codecJson)
    assertEquals(envelopes.map(_.operation.baboonTypeIdentifier).distinct.size,10)
    assertEquals(envelopes.collect { case ClientEnvelope(_,Operation.ExpressionHints(query)) => query.target.baboonTypeIdentifier }.distinct.size,3)
    assertEquals(envelopes.collect { case ClientEnvelope(_,Operation.ReadMcpTest(_,_,sequence,_)) => sequence },Vector(9007199254740993L))
  }
  test("BA specified: API1.4 result golden bytes preserve counts, nullable usage, passage pages and all transient event variants") {
    val envelopes=checkList("api14-results",ServerEnvelope.codecJson)
    assertEquals(envelopes.map(_.result.baboonTypeIdentifier).distinct.size,8)
    val usage=envelopes.collectFirst { case ServerEnvelope(_,Result.ModelUsage(result)) => result }.getOrElse(fail("missing usage fixture"))
    assertEquals(usage.samples.map(_.purpose),List(ModelPurpose.Annotation,ModelPurpose.DocumentEmbedding,ModelPurpose.QueryEmbedding,ModelPurpose.McpTest))
    assertEquals(usage.samples.head.input.knownTokens,9007199254740993L)
    assertEquals(usage.samples.head.input.sampleAgeMillis,Some(Long.MaxValue))
    assert(usage.samples.filter(slice => slice.purpose==ModelPurpose.DocumentEmbedding || slice.purpose==ModelPurpose.QueryEmbedding).forall(slice => slice.output.isEmpty && slice.reasoningSubset.isEmpty))
    assertEquals(envelopes.collect { case ServerEnvelope(_,Result.Passages(result)) => result.format }.distinct.size,3)
    val runs=envelopes.collect { case ServerEnvelope(_,Result.McpTestRun(result)) => result }
    assertEquals(runs.map(_.state).distinct.size,7)
    assertEquals(runs.flatMap(_.events.map(_.item.baboonTypeIdentifier)).distinct.size,3)
    val protocol=new VersionedWire(conversions)
    envelopes.foreach(envelope => assertEquals(protocol.encodeServer("1.4.0",envelope),Wire.encode(ServerEnvelope.codecJson,envelope)))
    Wire.versions.supported.filterNot(_=="1.4.0").foreach { version =>
      envelopes.foreach(envelope => assertEquals(intercept[DomainError](protocol.encodeServer(version,envelope)).code,"version-mismatch"))
    }
  }
  test("Blackbox-Atomic: retained old exact search results upgrade through generated nested conversions") {
    val source=Fixtures.snapshot(); val id=java.util.UUID.randomUUID()
    val hit=SearchHit(SessionInfo(ContentView(1,None),id,"a",1,None,source.metadata,source.source,source.completion,false),Fragments.split(source.messages),0.5)
    val latest=SearchResult(List(hit),1,SearchCountScope.ExactMatches,None)
    val old=Wire.decode(chronicle.api.v1_0_0.SearchResult.codecJson,Wire.encode(SearchResult.codecJson,latest))
    assertEquals(conversions.up1_3_0.convert[chronicle.api.v1_3_0.SearchResult,SearchResult](conversions.up1_2_0.convert[chronicle.api.v1_2_0.SearchResult,chronicle.api.v1_3_0.SearchResult](conversions.up1_1_0.convert[chronicle.api.v1_1_0.SearchResult,chronicle.api.v1_2_0.SearchResult](conversions.up1_0_0.convert[chronicle.api.v1_0_0.SearchResult,chronicle.api.v1_1_0.SearchResult](old)))),latest)
  }
}
