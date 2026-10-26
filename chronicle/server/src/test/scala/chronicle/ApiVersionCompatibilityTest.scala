package chronicle

import baboon.runtime.shared.BaboonJsonCodec
import chronicle.api.*
import chronicle.api.{v1_0_0 as v10, v1_1_0 as v11, v1_2_0 as v12, v1_3_0 as v13}
import chronicle.protocol.ProtocolConversions
import io.circe.Json
import java.util.UUID

class ApiVersionCompatibilityTest extends munit.FunSuite {
  private val conversions=new ProtocolConversions
  private val protocol=new VersionedWire(conversions)
  private val id=UUID.fromString("00000000-0000-4000-8000-000000000001")
  private val view=ContentView(2,Some(id))
  private val filter=SearchFilter(Some("synthetic"),Some("main"),Some("2026-10-26T00:00:00Z"),None,List("λ🐎"))
  private val versions=List("1.0.0","1.1.0","1.2.0","1.3.0","1.4.0")
  private def round[A](codec: BaboonJsonCodec[A],json: Json): Json = {
    val encoded=Wire.encode(codec,Wire.decode(codec,json))
    assertEquals(encoded,json)
    encoded
  }
  private def clientRound(version: String,json: Json): Json = version match {
    case "1.0.0" => round(v10.ClientEnvelope.codecJson,json)
    case "1.1.0" => round(v11.ClientEnvelope.codecJson,json)
    case "1.2.0" => round(v12.ClientEnvelope.codecJson,json)
    case "1.3.0" => round(v13.ClientEnvelope.codecJson,json)
    case "1.4.0" => round(ClientEnvelope.codecJson,json)
  }
  private def up13(envelope: v13.ServerEnvelope): ServerEnvelope = conversions.up1_3_0.convert[v13.ServerEnvelope,ServerEnvelope](envelope)
  private def up12(envelope: v12.ServerEnvelope): ServerEnvelope = up13(conversions.up1_2_0.convert[v12.ServerEnvelope,v13.ServerEnvelope](envelope))
  private def up11(envelope: v11.ServerEnvelope): ServerEnvelope = up12(conversions.up1_1_0.convert[v11.ServerEnvelope,v12.ServerEnvelope](envelope))
  private def serverRound(version: String,json: Json): ServerEnvelope = version match {
    case "1.0.0" => up11(conversions.up1_0_0.convert[v10.ServerEnvelope,v11.ServerEnvelope](Wire.decode(v10.ServerEnvelope.codecJson,round(v10.ServerEnvelope.codecJson,json))))
    case "1.1.0" => up11(Wire.decode(v11.ServerEnvelope.codecJson,round(v11.ServerEnvelope.codecJson,json)))
    case "1.2.0" => up12(Wire.decode(v12.ServerEnvelope.codecJson,round(v12.ServerEnvelope.codecJson,json)))
    case "1.3.0" => up13(Wire.decode(v13.ServerEnvelope.codecJson,round(v13.ServerEnvelope.codecJson,json)))
    case "1.4.0" => Wire.decode(ServerEnvelope.codecJson,round(ServerEnvelope.codecJson,json))
  }
  test("BG specified: every retained operation uses its own codec and complete registered upgrade chain") {
    val common=List[Operation](
      Operation.Hello(versions),Operation.Ping("λ🐎"),Operation.Pong("heartbeat"),Operation.Whoami(),
      Operation.Search(SearchQuery("synthetic",SearchMode.Hybrid,filter,10,20)),Operation.GetSession(id,Some(view)),
      Operation.GetChunks(id,20,10,Some(view)),Operation.GetMessages(id,20,10,Some(view)),Operation.GetRaw(id,Some(2)),
      Operation.Related(id,10),Operation.Facets(filter),Operation.IngestStatus(20,10),Operation.RetryJob(id),
      Operation.ListTokens(),Operation.MintToken("synthetic",List(Scope.Read,Scope.Raw)),Operation.RevokeToken(id),
      Operation.ListGroups(),Operation.CreateGroup("synthetic"),Operation.Invite(id,"b"),Operation.AcceptInvite(id,true),
      Operation.RemoveMember(id,"b"),Operation.LeaveGroup(id),Operation.DeleteGroup(id),Operation.Receipt(id),Operation.Purge(id),Operation.Logout())
    val added13=List[Operation](
      Operation.Archive(ArchiveQuery("tag:\"λ🐎\"",ArchiveSort.Title,SortDirection.Asc,Some("synthetic-cursor"),10)),
      Operation.Activity(ActivityQuery("",ActivityCollectorSort.CurrentFailed,SortDirection.Desc,None,10)),
      Operation.ActivityJobs(ActivityJobsQuery(Some("collector"),ActivityJobScope.Historical,"",ActivityJobSort.JobId,SortDirection.Asc,None,10)),
      Operation.LocateMessage(id,view,"u"),Operation.PreviewRetryFailed(),Operation.ApplyRetryFailed("target","selection",true))
    versions.foreach { version =>
      val operations=common ++ (if(version>="1.2.0") List(Operation.CollectionStatus()) else Nil) ++ (if(version>="1.3.0") added13 else Nil)
      operations.foreach { operation =>
        val envelope=ClientEnvelope(id,operation)
        val json=clientRound(version,Wire.encode(ClientEnvelope.codecJson,envelope))
        assertEquals(protocol.decodeClient(version,json),envelope,s"$version ${operation.baboonTypeIdentifier}")
      }
      assertEquals(Wire.negotiate(List("unsupported",version)),version)
    }
  }
  test("BG specified: all retained result branches preserve pins, payloads and receipt shapes through every downgrade") {
    val snapshot=Fixtures.snapshot()
    val session=SessionInfo(view,id,"a",2,Some(2),snapshot.metadata,snapshot.source,snapshot.completion,false)
    val chunks=Fragments.split(snapshot.messages).map(_.copy(sessionId=id))
    val hit=SearchHit(session,chunks,0.5)
    val user=UserInfo("a","alice",List(Scope.Read,Scope.Raw))
    val token=TokenInfo(id,"synthetic",List(Scope.Read),"2026-10-26T00:00:00Z",false)
    val common=List[Result](
      Result.Hello(Wire.versions,user),Result.Pong("λ🐎"),Result.Ping("heartbeat"),Result.Whoami(user),
      Result.Search(SearchResult(List(hit),1,SearchCountScope.ExactMatches,None)),Result.Session(SessionResult(session,chunks)),
      Result.Chunks(ChunksResult(chunks,1,20,view)),Result.Messages(MessagesResult(snapshot.messages,1,20,view)),
      Result.Raw(RawResult(snapshot.files,2)),Result.Related(RelatedResult(List(hit))),
      Result.Facets(FacetsResult(List(Facet("synthetic",1)),List(Facet("main",1)),List(Facet("λ🐎",1)))),
      Result.Status(StatusResult(List(JobInfo(id,id,2,JobState.Failed,1,Some("synthetic"),0,None)),1)),
      Result.Tokens(TokensResult(List(ListedToken(token,TokenSource.Issued)))),Result.Token(TokenResult(token,None)),
      Result.Groups(GroupsResult(List(GroupInfo(id,"synthetic","a",List("a","b"))),List(InviteInfo(id,id,"b","2026-10-26T00:00:00Z")))),
      Result.Mutation(MutationReceipt(id,"synthetic",Some(id))),Result.Error(Failure("forbidden","synthetic")))
    val count=9007199254740993L
    val counts=JobCounts(count,0,0,count,0,0,0,0)
    val retryCounts=RetryFailedCounts(count,1,2,3,4,5,6)
    val added13=List[Result](
      Result.Archive(ArchiveResult(List(ArchiveRow(session,Some(view),Some(view),None,1,List("λ🐎"),None)),count,None,ArchiveTextScope.ExactLexical,None)),
      Result.Activity(ActivityResult("synthetic",user,count,0,counts,counts,List(ActivityCollector("collector",None,count,0,counts,counts)),count,count,None)),
      Result.ActivityJobs(ActivityJobsResult("synthetic",List(ActivityJob(JobInfo(id,id,2,JobState.Failed,1,Some("synthetic"),0,None),"profile",ActivityJobClass.Current,None,false,true,"collector",session,None)),count,None)),
      Result.LocatedMessage(MessageLocation(view,0,1)),Result.RetryFailedPreview(RetryFailedPlan("target","selection",retryCounts)),
      Result.RetryFailed(RetryFailedResult(id,"target",count,retryCounts)))
    versions.foreach { version =>
      val results=common ++ (if(version>="1.2.0") List(Result.CollectionStatus(CollectorStatusResult(Nil))) else Nil) ++ (if(version>="1.3.0") added13 else Nil)
      results.foreach { result =>
        val envelope=ServerEnvelope(id,result)
        assertEquals(serverRound(version,protocol.encodeServer(version,envelope)),envelope,s"$version ${result.baboonTypeIdentifier}")
      }
    }
    assertEquals(Wire.encode(Chunk.codecJson,chunks.head),Wire.encode(v13.Chunk.codecJson,conversions.down1_3_0.convert[Chunk,v13.Chunk](chunks.head)))
    assertEquals(Wire.encode(ActivityResult.codecJson,added13(1).asInstanceOf[Result.Activity].result),Wire.encode(v13.ActivityResult.codecJson,conversions.down1_3_0.convert[ActivityResult,v13.ActivityResult](added13(1).asInstanceOf[Result.Activity].result)))
  }
  test("BA specified: unknown versions and branches fail explicitly without substitution") {
    val request=Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,Operation.ModelUsage()))
    versions.filterNot(_=="1.4.0").foreach { version => assertEquals(intercept[DomainError](protocol.decodeClient(version,request)).code,"invalid") }
    assertEquals(intercept[DomainError](protocol.decodeClient("future",request)).code,"version-mismatch")
    assertEquals(intercept[DomainError](protocol.encodeServer("future",ServerEnvelope(id,Result.Pong("synthetic")))).code,"version-mismatch")
    assertEquals(intercept[DomainError](Wire.negotiate(List("future"))).code,"version-mismatch")
  }
}
