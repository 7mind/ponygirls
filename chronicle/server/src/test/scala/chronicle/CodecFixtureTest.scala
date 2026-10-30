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
    List[BaboonJsonCodec[?]](chronicle.api.v1_0_0.ClientEnvelope.codecJson,chronicle.api.v1_1_0.ClientEnvelope.codecJson,chronicle.api.v1_2_0.ClientEnvelope.codecJson,chronicle.api.v1_3_0.ClientEnvelope.codecJson,chronicle.api.v1_4_0.ClientEnvelope.codecJson,chronicle.api.v1_5_0.ClientEnvelope.codecJson,chronicle.api.v1_6_0.ClientEnvelope.codecJson,chronicle.api.v1_7_0.ClientEnvelope.codecJson).foreach(codec => check("client",codec))
    List[BaboonJsonCodec[?]](chronicle.api.v1_0_0.ServerEnvelope.codecJson,chronicle.api.v1_1_0.ServerEnvelope.codecJson,chronicle.api.v1_2_0.ServerEnvelope.codecJson,chronicle.api.v1_3_0.ServerEnvelope.codecJson,chronicle.api.v1_4_0.ServerEnvelope.codecJson,chronicle.api.v1_5_0.ServerEnvelope.codecJson,chronicle.api.v1_6_0.ServerEnvelope.codecJson,chronicle.api.v1_7_0.ServerEnvelope.codecJson).foreach(codec => check("server",codec))
    List[BaboonJsonCodec[?]](chronicle.api.v1_0_0.IngestRequest.codecJson,chronicle.api.v1_1_0.IngestRequest.codecJson,chronicle.api.v1_2_0.IngestRequest.codecJson,chronicle.api.v1_3_0.IngestRequest.codecJson,chronicle.api.v1_4_0.IngestRequest.codecJson,chronicle.api.v1_5_0.IngestRequest.codecJson,chronicle.api.v1_6_0.IngestRequest.codecJson,chronicle.api.v1_7_0.IngestRequest.codecJson).foreach(codec => check("ingest",codec))
    List[BaboonJsonCodec[?]](chronicle.api.v1_2_0.CollectorProgressUpdate.codecJson,chronicle.api.v1_3_0.CollectorProgressUpdate.codecJson,chronicle.api.v1_4_0.CollectorProgressUpdate.codecJson,chronicle.api.v1_5_0.CollectorProgressUpdate.codecJson,chronicle.api.v1_6_0.CollectorProgressUpdate.codecJson,chronicle.api.v1_7_0.CollectorProgressUpdate.codecJson).foreach(codec => check("progress",codec))
  }
  private def checkList[A](name: String,codec: BaboonJsonCodec[A]): Vector[A] = {
    val raw=Files.readString(Path.of(s"server/src/test/fixtures/$name.json")).trim
    val fixtures=Wire.parse(raw).asArray.getOrElse(fail("expected codec fixture array"))
    val values=fixtures.map(json => Wire.decode(codec,json))
    assertEquals(io.circe.Json.fromValues(values.map(value => Wire.encode(codec,value))).noSpaces,raw,"crosslanguage golden bytes")
    values
  }
  test("BA specified: API1.4 client fixtures cover every additive branch and exact i64 sequence") {
    checkList("api14-clients",chronicle.api.v1_4_0.ClientEnvelope.codecJson)
    checkList("api14-clients",chronicle.api.v1_5_0.ClientEnvelope.codecJson)
    checkList("api14-clients",chronicle.api.v1_6_0.ClientEnvelope.codecJson)
    checkList("api14-clients",chronicle.api.v1_7_0.ClientEnvelope.codecJson)
    val envelopes=checkList("api14-clients",ClientEnvelope.codecJson)
    assertEquals(envelopes.map(_.operation.baboonTypeIdentifier).distinct.size,10)
    assertEquals(envelopes.collect { case ClientEnvelope(_,Operation.ExpressionHints(query)) => query.target.baboonTypeIdentifier }.distinct.size,3)
    assertEquals(envelopes.collect { case ClientEnvelope(_,Operation.ReadMcpTest(_,_,sequence,_)) => sequence },Vector(9007199254740993L))
  }
  test("BA specified: API1.4 result golden bytes preserve counts, nullable usage, passage pages and all transient event variants") {
    checkList("api14-results",chronicle.api.v1_4_0.ServerEnvelope.codecJson)
    checkList("api14-results",chronicle.api.v1_5_0.ServerEnvelope.codecJson)
    checkList("api14-results",chronicle.api.v1_6_0.ServerEnvelope.codecJson)
    checkList("api14-results",chronicle.api.v1_7_0.ServerEnvelope.codecJson)
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
    Wire.versions.supported.filterNot(version => Set("1.4.0","1.5.0","1.6.0","1.7.0","1.8.0").contains(version)).foreach { version =>
      envelopes.foreach(envelope => assertEquals(intercept[DomainError](protocol.encodeServer(version,envelope)).code,"version-mismatch"))
    }
  }
  test("BA: API1.5 Archive golden bytes retain explicit format and unknown provenance") {
    val retained=checkList("api15-results",chronicle.api.v1_5_0.ServerEnvelope.codecJson)
    val envelopes=retained.map(value => conversions.up1_7_0.convert[chronicle.api.v1_7_0.ServerEnvelope,ServerEnvelope](conversions.up1_6_0.convert[chronicle.api.v1_6_0.ServerEnvelope,chronicle.api.v1_7_0.ServerEnvelope](conversions.up1_5_0.convert[chronicle.api.v1_5_0.ServerEnvelope,chronicle.api.v1_6_0.ServerEnvelope](value))))
    val rows=envelopes.map(_.result.asInstanceOf[Result.Archive].result.rows.head)
    assertEquals(rows.map(_.publishedFormat),Vector(None,Some(PassageFormat.LegacyAnnotations),Some(PassageFormat.ContiguousProblems),None))
    assert(rows.take(3).forall(_.publishedView.nonEmpty)); assertEquals(rows.last.publishedView,None)
    assert(rows.forall(_.headJob.exists(_.state==JobState.Failed)))
    envelopes.foreach { envelope =>
      assertEquals(envelope.result.asInstanceOf[Result.Archive].result.relevanceOrdered,false)
      assertEquals(Wire.decode(ServerEnvelope.codecJson,Wire.encode(ServerEnvelope.codecJson,envelope)),envelope)
    }
  }
  test("BA specified: API1.6 literal-search goldens preserve exact pins, UTF8 literals and position-only results") {
    checkList("api16-clients",chronicle.api.v1_6_0.ClientEnvelope.codecJson)
    checkList("api16-clients",chronicle.api.v1_7_0.ClientEnvelope.codecJson)
    checkList("api16-results",chronicle.api.v1_6_0.ServerEnvelope.codecJson)
    checkList("api16-results",chronicle.api.v1_7_0.ServerEnvelope.codecJson)
    val requests=checkList("api16-clients",ClientEnvelope.codecJson)
    val operations=requests.map(_.operation.asInstanceOf[Operation.SearchSessionMessages])
    assertEquals(operations.map(_.cursor),Vector(None,Some("synthetic-cursor")))
    assertEquals(operations.map(_.limit),Vector(1,100))
    assert(operations.forall(_.view.generationId.nonEmpty))
    val responses=checkList("api16-results",ServerEnvelope.codecJson)
    val results=responses.map(_.result.asInstanceOf[Result.SessionMessageSearch].result)
    assertEquals(results.map(_.hits.size),Vector(0,2))
    assertEquals(results.last.hits.map(_.position),List(0,Int.MaxValue))
    assertEquals(results.map(_.nextCursor),Vector(None,Some("synthetic-cursor")))
    val protocol=new VersionedWire(conversions)
    requests.foreach(envelope => assertEquals(protocol.decodeClient("1.6.0",Wire.encode(ClientEnvelope.codecJson,envelope)),envelope))
    responses.foreach(envelope => assertEquals(protocol.encodeServer("1.6.0",envelope),Wire.encode(ServerEnvelope.codecJson,envelope)))
    Wire.versions.supported.filterNot(version => Set("1.6.0","1.7.0","1.8.0").contains(version)).foreach { version =>
      requests.foreach(envelope => assertEquals(intercept[DomainError](protocol.decodeClient(version,Wire.encode(ClientEnvelope.codecJson,envelope))).code,"invalid"))
      responses.foreach { envelope =>
        val failure=intercept[DomainError](protocol.encodeServer(version,envelope))
        assertEquals(failure.code,"version-mismatch")
        assertEquals(failure.detail,"response is not available in negotiated API version")
      }
    }
  }
  test("BA: API1.7 current rebuild and nullable failure-stage golden bytes remain exact") {
    checkList("api17-clients",chronicle.api.v1_7_0.ClientEnvelope.codecJson)
    checkList("api17-results",chronicle.api.v1_7_0.ServerEnvelope.codecJson)
    val requests=checkList("api17-clients",ClientEnvelope.codecJson)
    val responses=checkList("api17-results",ServerEnvelope.codecJson)
    assert(requests.exists(_.operation.isInstanceOf[Operation.GetReindexStatus]))
    val statuses=responses.collect { case ServerEnvelope(_,Result.ReindexStatus(value)) => value }
    assert(statuses.nonEmpty); statuses.foreach(value => assertEquals(value.complete+value.superseded+value.failed+value.pending,value.total))
    requests.foreach(value => assertEquals(intercept[DomainError](Wire.decode(chronicle.api.v1_6_0.ClientEnvelope.codecJson,Wire.encode(ClientEnvelope.codecJson,value))).code,"invalid"))
  }
  test("BA specified: API1.8 archive flags roundtrip both required Boolean values without changing ArchiveSort") {
    val requests=checkList("api18-clients",ClientEnvelope.codecJson)
    val responses=checkList("api18-results",ServerEnvelope.codecJson)
    assertEquals(requests.map(_.operation.asInstanceOf[Operation.Archive].query.preferRelevance),Vector(false,true))
    assertEquals(responses.map(_.result.asInstanceOf[Result.Archive].result.relevanceOrdered),Vector(false,true))
    assertEquals(ArchiveSort.all.map(_.toString).toSet,Set("LastTimestamp","Title","Owner","Project","Branch","Producer","Format","Model","Status","MessageCount","Tags"))
  }
  test("BA specified: latest archive decoders reject missing required flags while retained own codecs upgrade false") {
    val requests=checkList("api18-clients",ClientEnvelope.codecJson)
    requests.foreach { envelope =>
      val query=envelope.operation.asInstanceOf[Operation.Archive].query
      val oldJson=Wire.encode(ArchiveQuery.codecJson,query).mapObject(_.remove("preferRelevance"))
      assertEquals(intercept[DomainError](Wire.decode(ArchiveQuery.codecJson,oldJson)).code,"invalid")
      val old=Wire.decode(chronicle.api.v1_7_0.ArchiveQuery.codecJson,oldJson)
      assertEquals(Wire.encode(chronicle.api.v1_7_0.ArchiveQuery.codecJson,old),oldJson)
      val upgraded=conversions.up1_7_0.convert[chronicle.api.v1_7_0.ArchiveQuery,ArchiveQuery](old)
      assertEquals(upgraded,query.copy(preferRelevance=false))
      assertEquals(Wire.decode(ArchiveQuery.codecJson,Wire.encode(ArchiveQuery.codecJson,upgraded)),upgraded)
    }
    val responses=checkList("api18-results",ServerEnvelope.codecJson)
    responses.foreach { envelope =>
      val result=envelope.result.asInstanceOf[Result.Archive].result
      val oldJson=Wire.encode(ArchiveResult.codecJson,result).mapObject(_.remove("relevanceOrdered"))
      assertEquals(intercept[DomainError](Wire.decode(ArchiveResult.codecJson,oldJson)).code,"invalid")
      val old=Wire.decode(chronicle.api.v1_7_0.ArchiveResult.codecJson,oldJson)
      assertEquals(Wire.encode(chronicle.api.v1_7_0.ArchiveResult.codecJson,old),oldJson)
      val upgraded=conversions.up1_7_0.convert[chronicle.api.v1_7_0.ArchiveResult,ArchiveResult](old)
      assertEquals(upgraded,result.copy(relevanceOrdered=false))
      assertEquals(Wire.decode(ArchiveResult.codecJson,Wire.encode(ArchiveResult.codecJson,upgraded)),upgraded)
    }
  }
  test("Blackbox-Atomic: retained old exact search results upgrade through generated nested conversions") {
    val source=Fixtures.snapshot(); val id=java.util.UUID.randomUUID()
    val hit=SearchHit(SessionInfo(ContentView(1,None),id,"a",1,None,source.metadata,source.source,source.completion,false),Fragments.split(source.messages),0.5)
    val latest=SearchResult(List(hit),1,SearchCountScope.ExactMatches,None)
    val old=Wire.decode(chronicle.api.v1_0_0.SearchResult.codecJson,Wire.encode(SearchResult.codecJson,latest))
    val v11=conversions.up1_0_0.convert[chronicle.api.v1_0_0.SearchResult,chronicle.api.v1_1_0.SearchResult](old)
    val v12=conversions.up1_1_0.convert[chronicle.api.v1_1_0.SearchResult,chronicle.api.v1_2_0.SearchResult](v11)
    val v13=conversions.up1_2_0.convert[chronicle.api.v1_2_0.SearchResult,chronicle.api.v1_3_0.SearchResult](v12)
    val v14=conversions.up1_3_0.convert[chronicle.api.v1_3_0.SearchResult,chronicle.api.v1_4_0.SearchResult](v13)
    val v15=conversions.up1_4_0.convert[chronicle.api.v1_4_0.SearchResult,chronicle.api.v1_5_0.SearchResult](v14)
    val v16=conversions.up1_5_0.convert[chronicle.api.v1_5_0.SearchResult,chronicle.api.v1_6_0.SearchResult](v15)
    val v17=conversions.up1_6_0.convert[chronicle.api.v1_6_0.SearchResult,chronicle.api.v1_7_0.SearchResult](v16)
    assertEquals(conversions.up1_7_0.convert[chronicle.api.v1_7_0.SearchResult,SearchResult](v17),latest)
  }
}
