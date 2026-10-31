package chronicle
import chronicle.api.*
import baboon.runtime.shared.BaboonJsonCodec
import java.nio.file.{Files,Path}
class CodecFixtureTest extends munit.FunSuite {
  def check[A](name: String,codec: BaboonJsonCodec[A]): Unit = {
    val raw=Files.readString(Path.of(s"server/src/test/fixtures/$name.json")).trim
    val json=Wire.parse(raw)
    assertEquals(Wire.encode(codec,Wire.decode(codec,json)).noSpaces,json.noSpaces,"crosslanguage compact golden bytes")
  }
  private def checkList[A](name: String,codec: BaboonJsonCodec[A]): Vector[A] = {
    val raw=Files.readString(Path.of(s"server/src/test/fixtures/$name.json")).trim
    val fixtures=Wire.parse(raw).asArray.getOrElse(fail("expected codec fixture array"))
    val values=fixtures.map(json => Wire.decode(codec,json))
    assertEquals(io.circe.Json.fromValues(values.map(value => Wire.encode(codec,value))).noSpaces,raw,"crosslanguage golden bytes")
    values
  }
  test("BA: crosslanguage client fixture UUID ADT enum timestamp Unicode nullable") { check("client",ClientEnvelope.codecJson) }
  test("BA: crosslanguage chunk result UTF8 spans and score") { check("server",ServerEnvelope.codecJson) }
  test("BA: crosslanguage collector ingest fixture") { check("ingest",IngestRequest.codecJson) }
  test("BA: crosslanguage progress decimal i64 strings preserve exact sequence and payload sizes") { check("progress",CollectorProgressUpdate.codecJson) }
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
  }
  test("BA specified: API1.6 literal-search goldens preserve exact pins, UTF8 literals and position-only results") {
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
  }
  test("BA: API1.7 current rebuild and nullable failure-stage golden bytes remain exact") {
    val requests=checkList("api17-clients",ClientEnvelope.codecJson)
    val responses=checkList("api17-results",ServerEnvelope.codecJson)
    assert(requests.exists(_.operation.isInstanceOf[Operation.GetReindexStatus]))
    val statuses=responses.collect { case ServerEnvelope(_,Result.ReindexStatus(value)) => value }
    assert(statuses.nonEmpty); statuses.foreach(value => assertEquals(value.complete+value.superseded+value.failed+value.pending,value.total))
  }
  test("BA specified: API1.8 archive flags roundtrip both required Boolean values without changing ArchiveSort") {
    val requests=checkList("api18-clients",ClientEnvelope.codecJson)
    val responses=checkList("api18-results",ServerEnvelope.codecJson)
    assertEquals(requests.map(_.operation.asInstanceOf[Operation.Archive].query.preferRelevance),Vector(false,true))
    assertEquals(responses.map(_.result.asInstanceOf[Result.Archive].result.relevanceOrdered),Vector(false,true))
    assertEquals(ArchiveSort.all.map(_.toString).toSet,Set("LastTimestamp","Title","Owner","Project","Branch","Producer","Format","Model","Status","MessageCount","Tags"))
  }
  test("BA specified: archive decoders reject missing required flags without compatibility defaults") {
    val requests=checkList("api18-clients",ClientEnvelope.codecJson)
    requests.foreach { envelope =>
      val query=envelope.operation.asInstanceOf[Operation.Archive].query
      val oldJson=Wire.encode(ArchiveQuery.codecJson,query).mapObject(_.remove("preferRelevance"))
      assertEquals(intercept[DomainError](Wire.decode(ArchiveQuery.codecJson,oldJson)).code,"invalid")
    }
    val responses=checkList("api18-results",ServerEnvelope.codecJson)
    responses.foreach { envelope =>
      val result=envelope.result.asInstanceOf[Result.Archive].result
      val oldJson=Wire.encode(ArchiveResult.codecJson,result).mapObject(_.remove("relevanceOrdered"))
      assertEquals(intercept[DomainError](Wire.decode(ArchiveResult.codecJson,oldJson)).code,"invalid")
    }
  }
  test("BA specified: API1.9 context golden bytes roundtrip through the sole codec boundary") {
    val requests=checkList("api19-clients",ClientEnvelope.codecJson)
    val responses=checkList("api19-results",ServerEnvelope.codecJson)
    val protocol=new VersionedWire
    requests.foreach(value => assertEquals(protocol.decodeClient("1.9.0",Wire.encode(ClientEnvelope.codecJson,value)),value))
    responses.foreach(value => assertEquals(protocol.encodeServer("1.9.0",value),Wire.encode(ServerEnvelope.codecJson,value)))
  }

  test("BA specified: archive source-search goldens preserve Archive counts, independent HEAD and generation evidence pins") {
    val requests=checkList("archive-search-clients",ClientEnvelope.codecJson)
    val responses=checkList("archive-search-results",ServerEnvelope.codecJson)
    assertEquals(requests.head.operation.asInstanceOf[Operation.ArchiveSearch].query.limit,10)
    val value=responses.head.result.asInstanceOf[Result.ArchiveSearch].result
    assertEquals(value.page.total,9007199254740993L)
    assertEquals(value.evidence.head.matches.map(_.kind),List(ArchiveMatchKind.Literal,ArchiveMatchKind.Semantic))
    assertEquals(value.evidence.head.matches.map(_.view.revision),List(2,1))
    assertEquals(value.evidence.map(_.sessionId),value.page.rows.map(_.head.id))
    assertEquals(responses.last.result.asInstanceOf[Result.ArchiveSearch].result.evidence,Nil)
  }

}
