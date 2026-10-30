package chronicle
import chronicle.api.*
import chronicle.api.{v1_0_0 as v10, v1_1_0 as v11, v1_2_0 as v12, v1_3_0 as v13, v1_4_0 as v14,v1_5_0 as v15,v1_6_0 as v16,v1_7_0 as v17}
import chronicle.protocol.ProtocolConversions
import java.util.UUID

class ProtocolEvolutionTest extends munit.FunSuite {
  private val conversions=new ProtocolConversions
  private val protocol=new VersionedWire(conversions)
  private def upgrade17(value: v17.ServerEnvelope): ServerEnvelope = conversions.up1_7_0.convert[v17.ServerEnvelope,ServerEnvelope](value)
  private def upgrade15(value: v15.ServerEnvelope): ServerEnvelope = upgrade17(conversions.up1_6_0.convert[v16.ServerEnvelope,v17.ServerEnvelope](conversions.up1_5_0.convert[v15.ServerEnvelope,v16.ServerEnvelope](value)))
  private def upgrade14(value: v14.ServerEnvelope): ServerEnvelope = upgrade15(conversions.up1_4_0.convert[v14.ServerEnvelope,v15.ServerEnvelope](value))
  private def upgrade13(value: v13.ServerEnvelope): ServerEnvelope = upgrade14(conversions.up1_3_0.convert[v13.ServerEnvelope,v14.ServerEnvelope](value))
  private def upgrade12(value: v12.ServerEnvelope): ServerEnvelope = upgrade13(conversions.up1_2_0.convert[v12.ServerEnvelope,v13.ServerEnvelope](value))
  private val id=UUID.fromString("00000000-0000-4000-8000-000000000001")
  private val info=TokenInfo(id,"issued",List(Scope.Ingest),"2026-10-26T00:00:00Z",false)
  test("Whitebox regression: protocol conversion registrations initialize in per-version helper methods") {
    val expected=Wire.versions.supported.tail.flatMap { version =>
      List("up","down").map(direction => "initialize_"+direction+version.replace('.','_'))
    }.toSet
    val actual=classOf[ProtocolConversions].getDeclaredMethods.iterator.map(_.getName).filter(_.startsWith("initialize_")).toSet
    assertEquals(actual,expected)
  }
  test("BA specified: API1.7 negotiation retains every published version") {
    assertEquals(Wire.versions,VersionInfo("1.8.0","1.0.0",List("1.8.0","1.7.0","1.6.0","1.5.0","1.4.0","1.3.0","1.2.0","1.1.0","1.0.0")))
    assertEquals(Wire.negotiate(Wire.versions.supported.reverse),"1.8.0")
  }
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
      Result.Status(StatusResult(List(JobInfo(id,id,1,JobState.Running,1,None,4,Some(9),None)),1)),
      Result.Search(SearchResult(Nil,0,SearchCountScope.ExactMatches,None)),Result.Error(Failure("forbidden","denied")))
    results.foreach { result =>
      val envelope=ServerEnvelope(id,result)
      val json10=protocol.encodeServer("1.0.0",envelope)
      val json11=protocol.encodeServer("1.1.0",envelope)
      assertEquals(Wire.encode(v10.ServerEnvelope.codecJson,Wire.decode(v10.ServerEnvelope.codecJson,json10)),json10)
      assertEquals(Wire.encode(v11.ServerEnvelope.codecJson,Wire.decode(v11.ServerEnvelope.codecJson,json11)),json11)
      val upgraded=upgrade13(conversions.up1_2_0.convert[v12.ServerEnvelope,v13.ServerEnvelope](conversions.up1_1_0.convert[v11.ServerEnvelope,v12.ServerEnvelope](Wire.decode(v11.ServerEnvelope.codecJson,json11))))
      result match {
        case _: Result.Tokens => assertEquals(upgraded.result.asInstanceOf[Result.Tokens].result.tokens.map(_.source),List(TokenSource.Issued,TokenSource.Issued)); assert(!json11.noSpaces.contains("StaticConfig"))
        case _: Result.Status => val job=upgraded.result.asInstanceOf[Result.Status].result.jobs.head; assertEquals(job.completedWindows,0); assertEquals(job.totalWindows,None); assert(!json10.noSpaces.contains("completedWindows"))
        case _ => assertEquals(upgraded,envelope)
      }
      assertEquals(upgrade12(Wire.decode(v12.ServerEnvelope.codecJson,protocol.encodeServer("1.2.0",envelope))),envelope)
    }
    // Persisted issued-token receipts deliberately retain their exact shape.
    assertEquals(Wire.encode(TokenInfo.codecJson,info),Wire.encode(v11.TokenInfo.codecJson,conversions.down1_1_0.convert[v12.TokenInfo,v11.TokenInfo](conversions.down1_2_0.convert[v13.TokenInfo,v12.TokenInfo](conversions.down1_3_0.convert[v14.TokenInfo,v13.TokenInfo](conversions.down1_4_0.convert[chronicle.api.v1_5_0.TokenInfo,v14.TokenInfo](conversions.down1_5_0.convert[v16.TokenInfo,chronicle.api.v1_5_0.TokenInfo](conversions.down1_6_0.convert[v17.TokenInfo,v16.TokenInfo](conversions.down1_7_0.convert[TokenInfo,v17.TokenInfo](info)))))))))
  }
  test("BA specified:1.3 archive, activity and locator codecs preserve pins and exact i64 totals") {
    val maximum=9007199254740993L
    val counts=JobCounts(maximum,0,0,0,maximum,0,0,0)
    val source=Fixtures.snapshot()
    val head=SessionInfo(ContentView(2,None),id,"a",2,Some(1),source.metadata,source.source,source.completion,false)
    val published=ContentView(1,Some(id))
    val row=ArchiveRow(head,Some(published),Some(published),Some("2026-10-26T00:00:00Z"),3,List("work"),None,None)
    val values=List[Result](
      Result.Archive(ArchiveResult(List(row),maximum,None,ArchiveTextScope.BoundedCandidateSets,Some(1000),false)),
      Result.Activity(ActivityResult("2026-10-26T00:00:00Z",UserInfo("a","a",List(Scope.Read)),maximum,0,counts,counts,List(ActivityCollector("reportless",None,maximum,0,counts,counts)),maximum,maximum,None)),
      Result.ActivityJobs(ActivityJobsResult("2026-10-26T00:00:00Z",Nil,maximum,None)),
      Result.LocatedMessage(MessageLocation(published,2,3)))
    values.foreach { result =>
      val envelope=ServerEnvelope(id,result)
      val encoded=protocol.encodeServer("1.3.0",envelope)
      assertEquals(upgrade13(Wire.decode(v13.ServerEnvelope.codecJson,encoded)),envelope)
      if(!result.isInstanceOf[Result.LocatedMessage]) assert(encoded.noSpaces.contains("\"9007199254740993\""))
    }
    assertEquals(Wire.negotiate(List("1.3.0","1.2.0","1.1.0","1.0.0")),"1.3.0")
  }
  test("BA: published format is explicit in1.5 and unknown after a retained-version upgrade") {
    val source=Fixtures.snapshot(); val view=ContentView(1,Some(id))
    val head=SessionInfo(ContentView(2,None),id,"a",2,Some(1),source.metadata,source.source,source.completion,false)
    val job=JobInfo(id,id,2,JobState.Failed,5,Some("model-output"),1,Some(3),None)
    List(None,Some(PassageFormat.LegacyAnnotations),Some(PassageFormat.ContiguousProblems)).foreach { format =>
      val row=ArchiveRow(head,Some(view),Some(view),None,3,List("work"),Some(job),format)
      val envelope=ServerEnvelope(id,Result.Archive(ArchiveResult(List(row),1L,None,ArchiveTextScope.ExactLexical,None,false)))
      assertEquals(upgrade15(Wire.decode(v15.ServerEnvelope.codecJson,protocol.encodeServer("1.5.0",envelope))),envelope)
      List("1.3.0","1.4.0").foreach { version =>
        val encoded=protocol.encodeServer(version,envelope)
        assert(!encoded.noSpaces.contains("\"publishedFormat\""))
        val upgraded=if(version=="1.3.0") upgrade13(Wire.decode(v13.ServerEnvelope.codecJson,encoded)) else upgrade14(Wire.decode(v14.ServerEnvelope.codecJson,encoded))
        val retained=upgraded.result.asInstanceOf[Result.Archive].result.rows.head
        assertEquals(retained,row.copy(publishedFormat=None))
      }
      val legacy=Wire.decode(v14.ServerEnvelope.codecJson,protocol.encodeServer("1.4.0",envelope)).result.asInstanceOf[v14.Result.Archive].result.rows.head
      assertEquals(Wire.encode(v14.ArchiveRow.codecJson,legacy).asObject.get.keys.toSet,Set("head","publishedView","matchedView","lastTimestamp","messageCount","tags","headJob"))
    }
  }
  test("BG regression: unsupported result downgrades are explicit and content-free") {
    val report=CollectorProgressUpdate("PRIVATE_POISON",0,id,CollectorPhase.Idle,"synthetic",CollectorCounters(0,0,0,0,0,0,0,0,0,0,0,0,0),0,0,None,None)
    val examples=List(
      (List("1.0.0","1.1.0","1.2.0","1.3.0"),Result.ExpressionHints(ExpressionHintsResult("PRIVATE_POISON","synthetic",0,0,Nil,false))),
      (List("1.0.0","1.1.0","1.2.0"),Result.ActivityJobs(ActivityJobsResult("PRIVATE_POISON",Nil,0,None))),
      (List("1.0.0","1.1.0"),Result.CollectionStatus(CollectorStatusResult(List(CollectorStatus(report,"synthetic",false))))))
    examples.foreach { case (versions,result) => versions.foreach { version =>
      val failure=intercept[DomainError](protocol.encodeServer(version,ServerEnvelope(id,result)))
      assertEquals(failure.code,"version-mismatch")
      assertEquals(failure.detail,"response is not available in negotiated API version")
      assertEquals(failure.getMessage,"version-mismatch")
      assert(!failure.toString.contains("PRIVATE_POISON"))
    }}
  }
  test("BG specified: retained archive requests preserve old ordering and only false relevance results downgrade") {
    val old=v17.ClientEnvelope(id,v17.Operation.Archive(v17.ArchiveQuery("PRIVATE_POISON",v17.ArchiveSort.Title,v17.SortDirection.Asc,None,10)))
    val oldJson=Wire.encode(v17.ClientEnvelope.codecJson,old)
    List("1.3.0","1.4.0","1.5.0","1.6.0","1.7.0").foreach { version =>
      val upgraded=protocol.decodeClient(version,oldJson)
      assertEquals(upgraded.operation.asInstanceOf[Operation.Archive].query.preferRelevance,false)
      val result=ArchiveResult(Nil,9007199254740993L,Some("PRIVATE_POISON"),ArchiveTextScope.ExactLexical,None,false)
      val envelope=ServerEnvelope(id,Result.Archive(result))
      val encoded=protocol.encodeServer(version,envelope)
      assert(!encoded.noSpaces.contains("relevanceOrdered"))
      val decoded=if(version=="1.7.0") upgrade17(Wire.decode(v17.ServerEnvelope.codecJson,encoded))
        else if(version=="1.6.0") upgrade17(conversions.up1_6_0.convert[v16.ServerEnvelope,v17.ServerEnvelope](Wire.decode(v16.ServerEnvelope.codecJson,encoded)))
        else if(version=="1.5.0") upgrade15(Wire.decode(v15.ServerEnvelope.codecJson,encoded))
        else if(version=="1.4.0") upgrade14(Wire.decode(v14.ServerEnvelope.codecJson,encoded))
        else upgrade13(Wire.decode(v13.ServerEnvelope.codecJson,encoded))
      assertEquals(decoded,envelope)
      val failure=intercept[DomainError](protocol.encodeServer(version,envelope.copy(result=Result.Archive(result.copy(relevanceOrdered=true)))))
      assertEquals(failure.code,"version-mismatch")
      assertEquals(failure.detail,"relevance-ordered archive results require API1.8")
      assertEquals(failure.getMessage,"version-mismatch")
      assert(!failure.toString.contains("PRIVATE_POISON"))
    }
    val current=ClientEnvelope(id,Operation.Archive(ArchiveQuery("synthetic",ArchiveSort.Title,SortDirection.Asc,None,10,true)))
    assertEquals(protocol.decodeClient("1.8.0",Wire.encode(ClientEnvelope.codecJson,current)),current)
    val result=ServerEnvelope(id,Result.Archive(ArchiveResult(Nil,0,None,ArchiveTextScope.ExactLexical,None,true)))
    assertEquals(Wire.decode(ServerEnvelope.codecJson,protocol.encodeServer("1.8.0",result)),result)
  }
  test("BA specified: collector progress/status and ack retain i64 counters, optional values and UUIDs") {
    val report=CollectorProgressUpdate("collector",9007199254740993L,id,CollectorPhase.Uploading,"2026-10-26T00:00:00Z",CollectorCounters(1,2,3,4,5,6,7,8,9,10,11,12,9007199254740993L),10000000000L,9000000000L,Some(1000000000L),Some("upload-failed"))
    assertEquals(Wire.decode(CollectorProgressUpdate.codecJson,Wire.encode(CollectorProgressUpdate.codecJson,report)),report)
    val ack=CollectorProgressAck(report.sequence,true)
    assertEquals(Wire.decode(CollectorProgressAck.codecJson,Wire.encode(CollectorProgressAck.codecJson,ack)),ack)
    val envelope=ServerEnvelope(id,Result.CollectionStatus(CollectorStatusResult(List(CollectorStatus(report,"2026-10-26T00:01:00Z",true)))))
    assertEquals(upgrade12(Wire.decode(v12.ServerEnvelope.codecJson,protocol.encodeServer("1.2.0",envelope))),envelope)
    assertEquals(protocol.decodeClient("1.2.0",Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,Operation.CollectionStatus()))).operation,Operation.CollectionStatus())
  }
}
