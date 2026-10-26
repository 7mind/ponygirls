package chronicle
import chronicle.api.*
import chronicle.api.{v1_0_0 as v10, v1_1_0 as v11, v1_2_0 as v12}
import chronicle.protocol.ProtocolConversions
import java.util.UUID

class ProtocolEvolutionTest extends munit.FunSuite {
  private val conversions=new ProtocolConversions
  private val protocol=new VersionedWire(conversions)
  private val id=UUID.fromString("00000000-0000-4000-8000-000000000001")
  private val info=TokenInfo(id,"issued",List(Scope.Ingest),"2026-10-26T00:00:00Z",false)
  test("BG specified: both retained versions upgrade every client operation through registered generated conversions") {
    val examples=List[v10.Operation](v10.Operation.Hello(List("1.0.0")),v10.Operation.Ping("nonce"),v10.Operation.Pong("heartbeat"),v10.Operation.ListTokens(),v10.Operation.MintToken("name",List(v10.Scope.Ingest)),v10.Operation.RevokeToken(id),v10.Operation.IngestStatus(0,10),v10.Operation.Search(v10.SearchQuery("archive",v10.SearchMode.Lexical,v10.SearchFilter(None,None,None,None,Nil),10,0)))
    examples.foreach { operation =>
      val old=v10.ClientEnvelope(id,operation)
      val middle=conversions.up1_0_0.convert[v10.ClientEnvelope,v11.ClientEnvelope](old)
      val first=protocol.decodeClient("1.0.0",Wire.encode(v10.ClientEnvelope.codecJson,old))
      val second=protocol.decodeClient("1.1.0",Wire.encode(v11.ClientEnvelope.codecJson,middle))
      assertEquals(first,second)
      assertEquals(first.requestId,id)
    }
    assertEquals(Wire.negotiate(List("1.0.0","1.1.0","1.2.0")),"1.2.0")
    assertEquals(Wire.negotiate(List("1.1.0","1.0.0")),"1.1.0")
  }
  test("BG specified: legacy response codecs project token wrappers and progress, preserve receipts and all common response branches") {
    val results=List[Result](
      Result.Hello(Wire.versions,UserInfo("a","alice",List(Scope.Read))),Result.Pong("nonce"),Result.Ping("heartbeat"),
      Result.Tokens(TokensResult(List(ListedToken(info,TokenSource.Issued),ListedToken(info.copy(name="static"),TokenSource.StaticConfig)))),
      Result.Token(TokenResult(info,Some("synthetic-once"))),Result.Mutation(MutationReceipt(id,"MintToken",Some(id))),
      Result.Status(StatusResult(List(JobInfo(id,id,1,JobState.Running,1,None,4,Some(9))),1)),
      Result.Search(SearchResult(Nil,0,SearchCountScope.ExactMatches,None)),Result.Error(Failure("forbidden","denied")))
    results.foreach { result =>
      val envelope=ServerEnvelope(id,result)
      val json10=protocol.encodeServer("1.0.0",envelope)
      val json11=protocol.encodeServer("1.1.0",envelope)
      assertEquals(Wire.encode(v10.ServerEnvelope.codecJson,Wire.decode(v10.ServerEnvelope.codecJson,json10)),json10)
      assertEquals(Wire.encode(v11.ServerEnvelope.codecJson,Wire.decode(v11.ServerEnvelope.codecJson,json11)),json11)
      val upgraded=conversions.up1_2_0.convert[v12.ServerEnvelope,ServerEnvelope](conversions.up1_1_0.convert[v11.ServerEnvelope,v12.ServerEnvelope](Wire.decode(v11.ServerEnvelope.codecJson,json11)))
      result match {
        case _: Result.Tokens => assertEquals(upgraded.result.asInstanceOf[Result.Tokens].result.tokens.map(_.source),List(TokenSource.Issued,TokenSource.Issued)); assert(!json11.noSpaces.contains("StaticConfig"))
        case _: Result.Status => val job=upgraded.result.asInstanceOf[Result.Status].result.jobs.head; assertEquals(job.completedWindows,0); assertEquals(job.totalWindows,None); assert(!json10.noSpaces.contains("completedWindows"))
        case _ => assertEquals(upgraded,envelope)
      }
      assertEquals(Wire.decode(ServerEnvelope.codecJson,protocol.encodeServer("1.2.0",envelope)),envelope)
    }
    // Persisted issued-token receipts deliberately retain their exact shape.
    assertEquals(Wire.encode(TokenInfo.codecJson,info),Wire.encode(v11.TokenInfo.codecJson,conversions.down1_1_0.convert[v12.TokenInfo,v11.TokenInfo](conversions.down1_2_0.convert[TokenInfo,v12.TokenInfo](info))))
  }
  test("BA specified:1.3 archive, activity and locator codecs preserve pins and exact i64 totals") {
    val maximum=9007199254740993L
    val counts=JobCounts(maximum,0,0,0,maximum,0,0,0)
    val source=Fixtures.snapshot()
    val head=SessionInfo(ContentView(2,None),id,"a",2,Some(1),source.metadata,source.source,source.completion,false)
    val published=ContentView(1,Some(id))
    val row=ArchiveRow(head,Some(published),Some(published),Some("2026-10-26T00:00:00Z"),3,List("work"),None)
    val values=List[Result](
      Result.Archive(ArchiveResult(List(row),maximum,None,ArchiveTextScope.BoundedCandidateSets,Some(1000))),
      Result.Activity(ActivityResult("2026-10-26T00:00:00Z",UserInfo("a","a",List(Scope.Read)),maximum,0,counts,counts,List(ActivityCollector("reportless",None,maximum,0,counts,counts)),maximum,maximum,None)),
      Result.ActivityJobs(ActivityJobsResult("2026-10-26T00:00:00Z",Nil,maximum,None)),
      Result.LocatedMessage(MessageLocation(published,2,3)))
    values.foreach { result =>
      val envelope=ServerEnvelope(id,result)
      val encoded=protocol.encodeServer("1.3.0",envelope)
      assertEquals(Wire.decode(ServerEnvelope.codecJson,encoded),envelope)
      if(!result.isInstanceOf[Result.LocatedMessage]) assert(encoded.noSpaces.contains("\"9007199254740993\""))
    }
    assertEquals(Wire.negotiate(List("1.3.0","1.2.0","1.1.0","1.0.0")),"1.3.0")
  }
  test("BA specified: collector progress/status and ack retain i64 counters, optional values and UUIDs") {
    val report=CollectorProgressUpdate("collector",9007199254740993L,id,CollectorPhase.Uploading,"2026-10-26T00:00:00Z",CollectorCounters(1,2,3,4,5,6,7,8,9,10,11,12,9007199254740993L),10000000000L,9000000000L,Some(1000000000L),Some("upload-failed"))
    assertEquals(Wire.decode(CollectorProgressUpdate.codecJson,Wire.encode(CollectorProgressUpdate.codecJson,report)),report)
    val ack=CollectorProgressAck(report.sequence,true)
    assertEquals(Wire.decode(CollectorProgressAck.codecJson,Wire.encode(CollectorProgressAck.codecJson,ack)),ack)
    val envelope=ServerEnvelope(id,Result.CollectionStatus(CollectorStatusResult(List(CollectorStatus(report,"2026-10-26T00:01:00Z",true)))))
    assertEquals(Wire.decode(ServerEnvelope.codecJson,protocol.encodeServer("1.2.0",envelope)),envelope)
    assertEquals(protocol.decodeClient("1.2.0",Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,Operation.CollectionStatus()))).operation,Operation.CollectionStatus())
  }
}
