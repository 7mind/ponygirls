package chronicle
import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.{Clock,Instant,ZoneOffset}
import java.util.{Base64,UUID}

private object ActivityTestData {
  val now=Instant.parse("2026-10-26T10:00:00Z")
  val user=UserInfo("a","owner",List(Scope.Read))
  val target="target-profile"
  val old="old-profile"
  val empty=JobCounts(0,0,0,0,0,0,0,0)
  def collectorQuery(cursor: Option[String],limit: Int): ActivityQuery = ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,cursor,limit)
  def jobsQuery(collectorId: Option[String],scope: ActivityJobScope,cursor: Option[String],limit: Int): ActivityJobsQuery = ActivityJobsQuery(collectorId,scope,"",ActivityJobSort.JobId,SortDirection.Asc,cursor,limit)
  def metadata(head: Head,revision: Int): Metadata = head.metadata.copy(title=head.metadata.title.replace("$revision",revision.toString),startedAt=activity(head,revision).map(_.toString),endedAt=None)
  def activity(head: Head,revision: Int): Option[Instant] = head.activity.map(_.minusSeconds((head.revision-revision).toLong*86400))
  def source(head: Head,revision: Int): SourceIdentity = SourceIdentity(if(revision==head.revision) head.namespace else "wrong-old-namespace","native",SourceFormat.Pi,head.id.toString,None)
  def session(head: Head,revision: Int): SessionInfo = SessionInfo(ContentView(revision,None),head.id,head.owner,head.revision,None,metadata(head,revision),source(head,revision),Completion.Quiescent,false)

  final case class Head(id: UUID,owner: String,revision: Int,namespace: String,tombstone: Boolean,activity: Option[Instant],metadata: Metadata)
  final case class Job(info: JobInfo,profile: String,lease: Option[Instant])
  final case class Report(owner: String,value: CollectorProgressUpdate,received: Instant)
  final case class Seed(heads: List[Head],jobs: List[Job],reports: List[Report],disabled: Set[String],observedAt: Instant)
  def id(n: Int): UUID = new UUID(0,n.toLong)
  def head(n: Int,owner: String,revision: Int,namespace: String,tombstone: Boolean): Head = Head(id(n),owner,revision,namespace,tombstone,None,Fixtures.snapshot().metadata.copy(title="revision-$revision"))
  def job(n: Int,session: Int,revision: Int,profile: String,state: JobState,lease: Option[Instant]): Job =
    Job(JobInfo(id(n),id(session),revision,state,5,Some("actual-error"),2,Some(4)),profile,lease)
  def report(owner: String,name: String,age: Long): Report = Report(owner,CollectorProgressUpdate(name,9007199254740993L,id(1000),CollectorPhase.Uploading,now.minusSeconds(600).toString,CollectorCounters(10,10,0,0,0,0,999,0,0,0,0,0,9007199254740993L),1000,500,Some(500),None),now.minusSeconds(age))
  def seed: Seed = Seed(
    List(head(1,"a",2,"base/episode/child",false),head(2,"a",1,"base/other",false),head(3,"a",1,"orphan/child",false),
      head(4,"a",1,"underXscore/child",false),head(5,"a",1,"under_score/child",false),head(6,"a",1,"percentX/child",false),
      head(7,"a",1,"percent%/child",false),head(8,"b",1,"base/episode/child",false),head(9,"a",1,"purged",true),head(10,"a",1,"baseball/child",false)),
    List(job(1,1,2,target,JobState.Failed,Some(now.plusSeconds(60))),job(2,1,1,target,JobState.Running,Some(now.plusSeconds(60))),
      job(3,1,2,old,JobState.Failed,None),job(4,1,1,old,JobState.Running,Some(now.minusSeconds(1))),
      job(5,2,1,target,JobState.Queued,Some(now.plusSeconds(60))),job(6,3,1,target,JobState.Running,Some(now.plusSeconds(60))),
      job(7,4,1,target,JobState.Running,Some(now)),job(8,5,1,target,JobState.Running,None),job(9,6,1,target,JobState.Complete,None),
      job(10,7,1,old,JobState.Queued,None),job(11,8,1,target,JobState.Failed,None),job(12,9,1,target,JobState.Running,Some(now.plusSeconds(60)))),
    List(report("a","base",120),report("a","base/episode",121),report("a","under_score",0),report("a","percent%",0),report("a","report-only",0),report("b","base",1)),Set.empty,now)
}

abstract class ActivityContract extends munit.FunSuite {
  import ActivityTestData.*
  def withIndex(seed: Seed)(f: ActivityIndex => Unit): Unit
  def allJobs(index: ActivityIndex,query: ActivityJobsQuery): List[ActivityJob] = {
    val out=List.newBuilder[ActivityJob]
    var cursor: Option[String]=None
    var pages=0
    var more=true
    while(more) {
      val page=index.jobs("a",query.copy(cursor=cursor))
      out++=page.jobs; cursor=page.nextCursor; more=cursor.nonEmpty; pages+=1
      assert(pages<=300,"job keyset must make progress")
    }
    out.result()
  }
  def allCollectors(index: ActivityIndex,limit: Int): List[ActivityCollector] = allCollectorQuery(index,collectorQuery(None,limit))
  def allCollectorQuery(index: ActivityIndex,query: ActivityQuery): List[ActivityCollector] = {
    val out=List.newBuilder[ActivityCollector]
    var cursor: Option[String]=None
    var pages=0
    var more=true
    while(more) {
      val page=index.summary(user,query.copy(cursor=cursor))
      out++=page.collectors; cursor=page.nextCursor; more=cursor.nonEmpty; pages+=1
      assert(pages<=300,"collector keyset must make progress")
    }
    out.result()
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: owner totals separate current work, history and missing target jobs") { withIndex(seed) { index =>
    val result=index.summary(user,collectorQuery(None,2))
    assertEquals(result.observedAt,now.toString); assertEquals(result.user,user)
    assertEquals(result.archiveHeads,8L); assertEquals(result.headsWithoutTargetJob,2L)
    assertEquals(result.current,JobCounts(6,1,3,1,1,1,1,1))
    assertEquals(result.historical,JobCounts(4,1,2,1,0,1,1,0))
    assertEquals(result.totalCollectors,9L); assertEquals(result.collectors.size,2)
    assert(result.nextCursor.nonEmpty)
    val other=index.summary(user.copy(id="b"),collectorQuery(None,100))
    assertEquals(other.archiveHeads,1L); assertEquals(other.current,JobCounts(1,0,0,1,0,0,0,0)); assertEquals(other.historical,empty)
    val without=index.summary(user.copy(id="c"),collectorQuery(None,100))
    assertEquals(without.archiveHeads,0L); assertEquals(without.current,empty); assertEquals(without.historical,empty)
    assertEquals(without.collectors,Nil); assertEquals(without.totalCollectors,0L); assertEquals(without.nextCursor,None)
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: collector union uses longest literal boundary and actual report freshness") { withIndex(seed) { index =>
    val collectors=allCollectors(index,2)
    val names=List("base","base/episode","baseball/child","orphan/child","percent%","percentX/child","report-only","underXscore/child","under_score")
    assertEquals(collectors.map(_.collectorId),names)
    def at(id: String): ActivityCollector = collectors.find(_.collectorId==id).get
    assertEquals(at("base").archiveHeads,1L); assertEquals(at("base/episode").archiveHeads,1L)
    assertEquals(at("base/episode").historical,JobCounts(3,0,2,1,0,1,1,0))
    assertEquals(at("base").status.map(_.receivedAt),Some(now.minusSeconds(120).toString))
    assertEquals(at("base").status.map(_.stale),Some(false)); assertEquals(at("base/episode").status.map(_.stale),Some(true))
    assertEquals(at("base").status.get.report.counters.uploaded,999)
    assertEquals(at("report-only").archiveHeads,0L); assertEquals(at("report-only").current,empty)
    assertEquals(at("percent%").headsWithoutTargetJob,1L)
    assertEquals(at("percentX/child").status,None); assertEquals(at("underXscore/child").status,None)
    assertEquals(at("orphan/child").status,None); assert(!collectors.exists(_.collectorId=="orphan"))
    assertEquals(collectors.map(_.archiveHeads).sum,8L); assertEquals(collectors.map(_.headsWithoutTargetJob).sum,2L)
    assertEquals(collectors.map(_.current.total).sum,6L); assertEquals(collectors.map(_.historical.total).sum,4L)
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: job pages retain actual state, both historical axes, leases and safe retry flags") { withIndex(seed) { index =>
    val query=jobsQuery(None,ActivityJobScope.All,None,3)
    val first=index.jobs("a",query)
    assertEquals(first.observedAt,now.toString); assertEquals(first.total,10L)
    val rows=allJobs(index,query)
    assertEquals(rows.map(_.job.id),(1 to 10).map(id).toList)
    assertEquals(rows.map(_.job),seed.jobs.take(10).map(_.info))
    assertEquals(rows.map(_.profile),seed.jobs.take(10).map(_.profile))
    assertEquals(rows.map(_.leaseExpiresAt),seed.jobs.take(10).map(_.lease.map(_.toString)))
    assertEquals(rows.map(_.classification),List(ActivityJobClass.Current,ActivityJobClass.SupersededRevision,ActivityJobClass.ObsoleteProfile,ActivityJobClass.SupersededRevisionAndProfile)++List.fill(5)(ActivityJobClass.Current)++List(ActivityJobClass.ObsoleteProfile))
    assertEquals(rows.filter(_.retryable).map(_.job.id),List(id(1)))
    assertEquals(rows.filter(_.leaseActive).map(_.job.id),List(id(2),id(6)))
    assertEquals(index.jobs("a",query.copy(scope=ActivityJobScope.Current)).total,6L)
    assertEquals(allJobs(index,query.copy(scope=ActivityJobScope.Current)).map(_.classification).distinct,List(ActivityJobClass.Current))
    assertEquals(index.jobs("a",query.copy(scope=ActivityJobScope.Historical)).total,4L)
    assert(!allJobs(index,query.copy(scope=ActivityJobScope.Historical)).exists(_.retryable))
    assertEquals(index.jobs("b",query).jobs.map(_.job.id),List(id(11)))
    assertEquals(index.jobs("c",query).total,0L)
    assertEquals(index.jobs("c",query).nextCursor,None)
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication regression: sub-microsecond observation never rounds a future lease into expiry") {
    withIndex(seed.copy(observedAt=now.minusNanos(400))) { index =>
      val summary=index.summary(user,collectorQuery(None,100))
      val jobs=index.jobs("a",jobsQuery(None,ActivityJobScope.Current,None,100))
      assertEquals(summary.observedAt,now.minusNanos(400).toString)
      assertEquals(summary.current.activeRunning,2L)
      assertEquals(summary.current.expiredRunning,0L)
      assertEquals(jobs.jobs.count(_.leaseActive).toLong,summary.current.activeRunning)
    }
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: job collector filter selects mapped heads exactly, including report-less namespaces") { withIndex(seed) { index =>
    val q=jobsQuery(Some("base/episode"),ActivityJobScope.All,None,2)
    assertEquals(index.jobs("a",q).total,4L)
    assertEquals(allJobs(index,q).map(_.job.id),(1 to 4).map(id).toList)
    assertEquals(index.jobs("a",q.copy(collectorId=Some("base"))).jobs.map(_.job.id),List(id(5)))
    assertEquals(index.jobs("a",q.copy(collectorId=Some("orphan/child"))).jobs.map(_.job.id),List(id(6)))
    List("orphan","missing","report-only","base' OR true --").foreach { name =>
      val result=index.jobs("a",q.copy(collectorId=Some(name)))
      assertEquals(result.total,0L); assertEquals(result.jobs,Nil); assertEquals(result.nextCursor,None)
    }
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: cursors validate type, owner and query binding; limits and collector IDs are bounded") { withIndex(seed) { index =>
    val summary=index.summary(user,collectorQuery(None,1)).nextCursor.get
    val query=jobsQuery(None,ActivityJobScope.All,None,1)
    val cursor=index.jobs("a",query).nextCursor.get
    def invalid(f: => Any): Unit = assertEquals(intercept[DomainError](f).code,"invalid")
    invalid(index.summary(user.copy(id="b"),collectorQuery(Some(summary),1)))
    invalid(index.jobs("b",query.copy(cursor=Some(cursor))))
    invalid(index.jobs("a",query.copy(scope=ActivityJobScope.Current,cursor=Some(cursor))))
    invalid(index.jobs("a",query.copy(collectorId=Some("base/episode"),cursor=Some(cursor))))
    val selected=query.copy(collectorId=Some("base/episode"))
    val selectedCursor=index.jobs("a",selected).nextCursor.get
    invalid(index.jobs("a",query.copy(cursor=Some(selectedCursor))))
    invalid(index.summary(user,collectorQuery(Some(cursor),1)))
    invalid(index.jobs("a",query.copy(cursor=Some(summary))))
    val fields=Wire.parse(new String(Base64.getUrlDecoder.decode(cursor),UTF_8)).asArray.get
    List(Json.fromString("not-a-uuid"),Json.fromString("1-1-1-1-1"),Json.fromInt(1),Json.Null).foreach { value =>
      val malformedId=Base64.getUrlEncoder.withoutPadding.encodeToString(Json.fromValues(fields.updated(fields.size-1,value)).noSpaces.getBytes(UTF_8))
      invalid(index.jobs("a",query.copy(cursor=Some(malformedId))))
    }
    val malformed=List("","%%%","e30",Base64.getUrlEncoder.encodeToString(Array(0xff.toByte)),"a"*8193)
    malformed.foreach { value =>
      invalid(index.summary(user,collectorQuery(Some(value),1)))
      invalid(index.jobs("a",query.copy(cursor=Some(value))))
    }
    List(0,-1,101,Int.MaxValue).foreach { limit =>
      invalid(index.summary(user,collectorQuery(None,limit)))
      invalid(index.jobs("a",query.copy(limit=limit)))
    }
    List("","a"*257,"nul\u0000","bad"+0xd800.toChar).foreach(value => invalid(index.jobs("a",query.copy(collectorId=Some(value)))))
    assertEquals(index.summary(user,collectorQuery(Some(summary),100)).collectors.size,8)
    assertEquals(index.jobs("a",query.copy(cursor=Some(cursor),limit=100)).jobs.size,9)
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: collector and UUID keysets continue beyond 100 without truncation") {
    val heads=(1 to 205).map(n => head(n,"a",1,f"namespace-$n%03d/child",false)).toList
    val jobs=(1 to 205).map(n => job(n,n,1,target,JobState.Queued,None)).toList
    withIndex(Seed(heads,jobs,Nil,Set.empty,now)) { index =>
      val first=index.summary(user,collectorQuery(None,100))
      assertEquals(first.archiveHeads,205L); assertEquals(first.totalCollectors,205L); assertEquals(first.current.total,205L)
      assertEquals(allCollectors(index,100).map(_.collectorId),heads.map(_.namespace))
      val query=jobsQuery(None,ActivityJobScope.All,None,100)
      assertEquals(index.jobs("a",query).total,205L)
      assertEquals(allJobs(index,query).map(_.job.id),jobs.map(_.info.id))
      assertEquals(allJobs(index,query.copy(sort=ActivityJobSort.Collector,direction=SortDirection.Desc)).map(_.job.id),jobs.reverse.map(_.info.id))
      val filtered=collectorQuery(None,2).copy(expression="\"namespace-2\"",sort=ActivityCollectorSort.ArchiveHeads,direction=SortDirection.Desc)
      assertEquals(index.summary(user,filtered).totalCollectors,6L)
      assertEquals(index.summary(user,filtered).allCollectors,205L)
      assertEquals(allCollectorQuery(index,filtered).map(_.collectorId),heads.takeRight(6).map(_.namespace))
    }
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: keysets preserve Unicode collector and unsigned UUID ordering without borrowing another owner's report") {
    val namespaces=List("😀/child","\ue000/child","other-owner/episode","exact","a/\"quoted\"")
    val heads=namespaces.zipWithIndex.map { case (namespace,n) => head(n+1,"a",1,namespace,false) }
    val uuidValues=List("ffffffff-ffff-ffff-ffff-ffffffffffff","80000000-0000-0000-0000-000000000000","00000000-0000-0000-0000-000000000000","7fffffff-ffff-ffff-ffff-ffffffffffff","00000000-0000-0000-8000-000000000000").map(UUID.fromString)
    val jobs=heads.zip(uuidValues).zipWithIndex.map { case ((h,uuid),n) =>
      val base=job(n+1,n+1,1,target,JobState.Queued,None)
      base.copy(info=base.info.copy(id=uuid,error=None,completedWindows=0,totalWindows=None))
    }
    withIndex(Seed(heads,jobs,List(report("b","other-owner",0),report("a","exact",0)),Set.empty,now)) { index =>
      val collectors=allCollectors(index,1)
      assertEquals(collectors.map(_.collectorId),List("a/\"quoted\"","exact","other-owner/episode","\ue000/child","😀/child"))
      assertEquals(collectors.find(_.collectorId=="exact").get.status.map(_.report.collectorId),Some("exact"))
      assertEquals(collectors.find(_.collectorId=="other-owner/episode").get.status,None)
      val actual=allJobs(index,jobsQuery(None,ActivityJobScope.All,None,1))
      assertEquals(actual.map(_.job.id.toString),uuidValues.map(_.toString).sorted)
      assert(actual.forall(j => j.job.error.isEmpty && j.job.totalWindows.isEmpty))
    }
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: live enabled ownership is required despite a retained UserInfo") {
    withIndex(seed.copy(disabled=Set("a"))) { index =>
      assertEquals(intercept[DomainError](index.summary(user,collectorQuery(None,1))).code,"unauthorized")
      assertEquals(intercept[DomainError](index.jobs("a",jobsQuery(None,ActivityJobScope.All,None,1))).code,"unauthorized")
      assertEquals(index.summary(user.copy(id="b"),collectorQuery(None,1)).archiveHeads,1L)
    }
  }
  private final case class ExpectedJobSort(sort: ActivityJobSort,groups: List[List[Int]],nulls: List[Int])
  private final case class ExpectedCollectorSort(sort: ActivityCollectorSort,groups: List[List[Int]],nulls: List[Int])
  private def timed: Seed = seed.copy(heads=seed.heads.map { h =>
    if(Set(3L,6L).contains(h.id.getLeastSignificantBits)) h else h.copy(activity=Some(now.minusSeconds(h.id.getLeastSignificantBits*86400)))
  })
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: metadata Boolean predicates use job revision fields, literal scalars and actual state") { withIndex(seed) { index =>
    val query=jobsQuery(None,ActivityJobScope.All,None,1)
    def selected(expression: String): List[Int] = allJobs(index,query.copy(expression=expression)).map(_.job.id.getLeastSignificantBits.toInt)
    assertEquals(selected("collector:base/episode AND classification:superseded-revision AND lease:active AND status:running"),List(2))
    assertEquals(selected("profile:target-profile AND status:failed"),List(1))
    assertEquals(selected("classification:obsolete-profile"),List(3,10))
    assertEquals(selected("classification:superseded-revision-and-profile"),List(4))
    assertEquals(selected("user:a AND tag:SYNTHETIC AND project:PROJECT AND branch:MAIN AND producer:PI AND format:pi"),(1 to 10).toList)
    assertEquals(selected("model:target-profile"),Nil)
    assertEquals(selected("NOT model:missing"),(1 to 10).toList)
    assertEquals(selected("reason:ACTUAL-ERROR"),(1 to 10).toList)
    assertEquals(selected("lease:inactive"),List(1,5))
    assertEquals(selected("lease:unleased"),List(3,8,9,10))
    assertEquals(selected("\"revision-1\""),List(2,4,5,6,7,8,9,10))
    assertEquals(selected("\"project revision\""),Nil)
    assertEquals(selected("\"must not decode snapshots\""),Nil)
    assertEquals(selected("\"%\""),List(10)); assertEquals(selected("\"_\""),List(8))
    assertEquals(selected("user:b"),Nil)
    val historical=allJobs(index,query.copy(expression="classification:superseded-revision")).head
    assertEquals(historical.session.metadata.title,"revision-1")
    assertEquals(historical.session.view,ContentView(1,None)); assertEquals(historical.session.revision,2)
    assertEquals(historical.session.source.collectorNamespace,"wrong-old-namespace")
    assertEquals(historical.collectorId,"base/episode")
    List("mode:lexical","mode:semantic","phase:Uploading","status:unscheduled").foreach { text =>
      assertEquals(intercept[DomainError](index.jobs("a",query.copy(expression=text))).code,"invalid")
    }
    assertEquals(selected("\"mode:semantic\""),Nil)
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: collector filtering leaves owner-universe totals explicitly unfiltered") { withIndex(seed) { index =>
    val original=index.summary(user,collectorQuery(None,100))
    val unknown=index.summary(user,collectorQuery(None,1).copy(expression="freshness:unknown"))
    assertEquals(unknown.totalCollectors,4L); assertEquals(unknown.allCollectors,9L)
    assertEquals(unknown.current,original.current); assertEquals(unknown.historical,original.historical)
    assertEquals(unknown.archiveHeads,original.archiveHeads); assertEquals(unknown.headsWithoutTargetJob,original.headsWithoutTargetJob)
    assertEquals(allCollectorQuery(index,collectorQuery(None,1).copy(expression="NOT phase:Uploading")).map(_.collectorId),List("baseball/child","orphan/child","percentX/child","underXscore/child"))
    assertEquals(index.summary(user,collectorQuery(None,10).copy(expression="phase:Uploading AND freshness:stale")).collectors.map(_.collectorId),List("base/episode"))
    assertEquals(index.summary(user,collectorQuery(None,10).copy(expression="collector:percent%")).collectors.map(_.collectorId),List("percent%"))
    assertEquals(index.summary(user,collectorQuery(None,10).copy(expression="\"%\"")).totalCollectors,1L)
    List("mode:lexical","mode:semantic","user:a","status:Running").foreach { text => assertEquals(intercept[DomainError](index.summary(user,collectorQuery(None,1).copy(expression=text))).code,"invalid") }
    val none=index.summary(user,collectorQuery(None,10).copy(expression="collector:nonexistent"))
    assertEquals(none.collectors,Nil); assertEquals(none.totalCollectors,0L); assertEquals(none.allCollectors,9L); assertEquals(none.nextCursor,None)
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: every job header sorts globally with ascending UUID ties and nulls last in both directions") {
    val varied=timed.copy(jobs=timed.jobs.map { j =>
      val n=j.info.id.getLeastSignificantBits.toInt
      j.copy(info=j.info.copy(attempts=n%3,completedWindows=n%2,totalWindows=if(n%3==0) None else Some(n%4+2),error=if(n%3==0) None else Some(if(n%2==0) "zETA" else "Alpha")))
    })
    val groups=List(
      ExpectedJobSort(ActivityJobSort.LastTimestamp,List(List(10),List(8),List(7),List(2,4,5),List(1,3)),List(6,9)),
      ExpectedJobSort(ActivityJobSort.Title,List(List(2,4,5,6,7,8,9,10),List(1,3)),Nil),
      ExpectedJobSort(ActivityJobSort.Collector,List(List(5),List(1,2,3,4),List(6),List(10),List(9),List(7),List(8)),Nil),
      ExpectedJobSort(ActivityJobSort.State,List(List(9),List(1,3),List(5,10),List(2,4,6,7,8)),Nil),
      ExpectedJobSort(ActivityJobSort.Revision,List(List(2,4,5,6,7,8,9,10),List(1,3)),Nil),
      ExpectedJobSort(ActivityJobSort.Profile,List(List(3,4,10),List(1,2,5,6,7,8,9)),Nil),
      ExpectedJobSort(ActivityJobSort.Attempts,List(List(3,6,9),List(1,4,7,10),List(2,5,8)),Nil),
      ExpectedJobSort(ActivityJobSort.CompletedWindows,List(List(2,4,6,8,10),List(1,3,5,7,9)),Nil),
      ExpectedJobSort(ActivityJobSort.TotalWindows,List(List(4,8),List(1,5),List(2,10),List(7)),List(3,6,9)),
      ExpectedJobSort(ActivityJobSort.LeaseExpiresAt,List(List(4),List(7),List(1,2,5,6)),List(3,8,9,10)),
      ExpectedJobSort(ActivityJobSort.LeaseState,List(List(2,6),List(4,7),List(1,5),List(3,8,9,10)),Nil),
      ExpectedJobSort(ActivityJobSort.Reason,List(List(1,5,7),List(2,4,8,10)),List(3,6,9)),
      ExpectedJobSort(ActivityJobSort.Classification,List(List(1,5,6,7,8,9),List(3,10),List(2),List(4)),Nil),
      ExpectedJobSort(ActivityJobSort.JobId,(1 to 10).map(n => List(n)).toList,Nil),
      ExpectedJobSort(ActivityJobSort.SessionId,List(List(1,2,3,4))++(5 to 10).map(n => List(n)).toList,Nil))
    assertEquals(groups.map(_.sort).toSet,ActivityJobSort.all.toSet)
    withIndex(varied) { index => groups.foreach { expectation => List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
      val expected=(if(direction==SortDirection.Asc) expectation.groups else expectation.groups.reverse).flatten++expectation.nulls
      val query=jobsQuery(None,ActivityJobScope.All,None,1).copy(sort=expectation.sort,direction=direction)
      val rows=allJobs(index,query)
      assertEquals(rows.map(_.job.id.getLeastSignificantBits.toInt),expected,s"${expectation.sort}/$direction")
      assertEquals(index.jobs("a",query.copy(limit=100)).jobs,rows)
      assertEquals(index.jobs("a",query).total,10L)
    }}}
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: every collector header sorts globally with ascending collector ties and nulls last") {
    val varied=seed.copy(reports=seed.reports.map { r =>
      val phase=r.value.collectorId match {
        case "base/episode" => CollectorPhase.Failed
        case "under_score" => CollectorPhase.Scanning
        case "percent%" => CollectorPhase.Idle
        case "report-only" => CollectorPhase.Discovering
        case _ => CollectorPhase.Uploading
      }
      r.copy(value=r.value.copy(phase=phase))
    })
    val ids=List("base","base/episode","baseball/child","orphan/child","percent%","percentX/child","report-only","underXscore/child","under_score")
    val all=(0 to 8).toList
    def counts(sort: ActivityCollectorSort,one: List[Int]): ExpectedCollectorSort = ExpectedCollectorSort(sort,List(all.filterNot(one.contains),one),Nil)
    val groups=List(
      ExpectedCollectorSort(ActivityCollectorSort.CollectorId,all.map(n => List(n)),Nil),
      ExpectedCollectorSort(ActivityCollectorSort.Phase,List(List(6),List(1),List(4),List(8),List(0)),List(2,3,5,7)),
      ExpectedCollectorSort(ActivityCollectorSort.Freshness,List(List(0,4,6,8),List(1),List(2,3,5,7)),Nil),
      ExpectedCollectorSort(ActivityCollectorSort.ReceivedAt,List(List(1),List(0),List(4,6,8)),List(2,3,5,7)),
      ExpectedCollectorSort(ActivityCollectorSort.ArchiveHeads,List(List(6),List(0,1,2,3,4,5,7,8)),Nil),
      counts(ActivityCollectorSort.HeadsWithoutTargetJob,List(2,4)),counts(ActivityCollectorSort.CurrentTotal,List(0,1,3,5,7,8)),
      counts(ActivityCollectorSort.CurrentQueued,List(0)),counts(ActivityCollectorSort.CurrentRunning,List(3,7,8)),counts(ActivityCollectorSort.CurrentFailed,List(1)),
      counts(ActivityCollectorSort.CurrentComplete,List(5)),counts(ActivityCollectorSort.CurrentActiveRunning,List(3)),counts(ActivityCollectorSort.CurrentExpiredRunning,List(7)),counts(ActivityCollectorSort.CurrentUnleasedRunning,List(8)),
      ExpectedCollectorSort(ActivityCollectorSort.HistoricalTotal,List(List(0,2,3,5,6,7,8),List(4),List(1)),Nil),
      counts(ActivityCollectorSort.HistoricalQueued,List(4)),counts(ActivityCollectorSort.HistoricalRunning,List(1)),counts(ActivityCollectorSort.HistoricalFailed,List(1)),
      ExpectedCollectorSort(ActivityCollectorSort.HistoricalComplete,List(all),Nil),counts(ActivityCollectorSort.HistoricalActiveRunning,List(1)),counts(ActivityCollectorSort.HistoricalExpiredRunning,List(1)),ExpectedCollectorSort(ActivityCollectorSort.HistoricalUnleasedRunning,List(all),Nil))
    assertEquals(groups.map(_.sort).toSet,ActivityCollectorSort.all.toSet)
    withIndex(varied) { index => groups.foreach { expectation => List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
      val expected=((if(direction==SortDirection.Asc) expectation.groups else expectation.groups.reverse).flatten++expectation.nulls).map(ids)
      val query=collectorQuery(None,1).copy(sort=expectation.sort,direction=direction)
      val rows=allCollectorQuery(index,query)
      assertEquals(rows.map(_.collectorId),expected,s"${expectation.sort}/$direction")
      assertEquals(index.summary(user,query.copy(limit=100)).collectors,rows)
      assertEquals(index.summary(user,query).totalCollectors,9L)
    }}}
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: source date predicates accept extreme Instants without PostgreSQL timestamptz casts") { withIndex(timed) { index =>
    val query=jobsQuery(None,ActivityJobScope.All,None,100)
    List(s"after:${Instant.MIN}",s"before:${Instant.MAX}").foreach { expression => assertEquals(index.jobs("a",query.copy(expression=expression)).total,8L) }
    List(s"after:${Instant.MAX}",s"before:${Instant.MIN}").foreach { expression => assertEquals(index.jobs("a",query.copy(expression=expression)).total,0L) }
    List(s"after:${Instant.MIN}",s"before:${Instant.MAX}").foreach { expression => assertEquals(index.summary(user,collectorQuery(None,100).copy(expression=expression)).totalCollectors,5L) }
    List(s"after:${Instant.MAX}",s"before:${Instant.MIN}").foreach { expression => assertEquals(index.summary(user,collectorQuery(None,100).copy(expression=expression)).totalCollectors,0L) }
    assertEquals(index.jobs("a",query.copy(expression="NOT after:2020-01-01")).jobs.map(_.job.id),List(id(6),id(9)))
    assertEquals(index.jobs("a",query.copy(expression="after:2026-10-25 AND before:2026-10-26")).jobs.map(_.job.id),List(id(1),id(3)))
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: freshness filtering and emitted flags agree across the microsecond boundary") {
    List(now.minusNanos(400),now,now.plusNanos(400)).foreach { observed => withIndex(seed.copy(observedAt=observed)) { index =>
      val result=index.summary(user,collectorQuery(None,100).copy(expression="collector:base AND freshness:stale"))
      assertEquals(result.totalCollectors,if(observed.isAfter(now)) 1L else 0L)
      assert(result.collectors.forall(_.status.exists(_.stale)))
    }}
  }
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: query-bound cursors reject invalid typed positions, UTF-8 and NUL before SQL") { withIndex(seed) { index =>
    val query=jobsQuery(None,ActivityJobScope.All,None,1).copy(sort=ActivityJobSort.Revision)
    val cursor=index.jobs("a",query).nextCursor.get
    val fields=Wire.parse(new String(Base64.getUrlDecoder.decode(cursor),UTF_8)).asArray.get
    def forge(value: Json): String = Base64.getUrlEncoder.withoutPadding.encodeToString(Json.fromValues(fields.updated(fields.size-2,value)).noSpaces.getBytes(UTF_8))
    val values=List(Json.fromInt(1),Json.Null)++List("not-a-number","NaN","Infinity","1e10000","-1","0.1","9999999999999999999","nul\u0000").map(Json.fromString)
    values.foreach { value => assertEquals(intercept[DomainError](index.jobs("a",query.copy(cursor=Some(forge(value))))).code,"invalid") }
    List(query.copy(expression="status:running"),query.copy(sort=ActivityJobSort.Attempts),query.copy(direction=SortDirection.Desc)).foreach { changed => assertEquals(intercept[DomainError](index.jobs("a",changed.copy(cursor=Some(cursor)))).code,"invalid") }
    val collector=collectorQuery(None,1)
    val next=index.summary(user,collector).nextCursor.get
    List(collector.copy(expression="freshness:unknown"),collector.copy(sort=ActivityCollectorSort.Phase),collector.copy(direction=SortDirection.Desc)).foreach { changed => assertEquals(intercept[DomainError](index.summary(user,changed.copy(cursor=Some(next)))).code,"invalid") }
    val textQuery=query.copy(sort=ActivityJobSort.Title)
    val textCursor=index.jobs("a",textQuery).nextCursor.get
    val textFields=Wire.parse(new String(Base64.getUrlDecoder.decode(textCursor),UTF_8)).asArray.get
    val nul=Base64.getUrlEncoder.withoutPadding.encodeToString(Json.fromValues(textFields.updated(textFields.size-2,Json.fromString("nul\u0000"))).noSpaces.getBytes(UTF_8))
    assertEquals(intercept[DomainError](index.jobs("a",textQuery.copy(cursor=Some(nul)))).code,"invalid")
    val surrogate=Json.fromValues(textFields.updated(textFields.size-2,Json.fromString("replacement-token"))).noSpaces.replace("replacement-token","\\ud800")
    val encoded=Base64.getUrlEncoder.withoutPadding.encodeToString(surrogate.getBytes(UTF_8))
    assertEquals(intercept[DomainError](index.jobs("a",textQuery.copy(cursor=Some(encoded)))).code,"invalid")
  }}
  test("Behavioral-Blackbox Atomic/GoodCommunication specified: long metadata keys page without a new cursor length ceiling or serialized-field matching") {
    val long="x"*10000
    val heads=(1 to 3).map(n => head(n,"a",1,s"long-$n",false)).toList.map(h => h.copy(metadata=h.metadata.copy(title=long+h.id.getLeastSignificantBits,tags=List("first","second"))))
    val jobs=(1 to 3).map(n => job(n,n,1,target,JobState.Queued,None)).toList
    withIndex(Seed(heads,jobs,Nil,Set.empty,now)) { index =>
      val query=jobsQuery(None,ActivityJobScope.All,None,1).copy(sort=ActivityJobSort.Title)
      assert(index.jobs("a",query).nextCursor.get.length>8192)
      assertEquals(allJobs(index,query).map(_.job.id),List(id(1),id(2),id(3)))
      assertEquals(index.jobs("a",query.copy(expression="\"first second\"")).total,0L)
      assertEquals(index.jobs("a",query.copy(expression="tag:first AND tag:second")).total,3L)
    }
  }


}

final class ActivityDummyTest extends ActivityContract {
  def withIndex(seed: ActivityTestData.Seed)(f: ActivityIndex => Unit): Unit = f(new DummyActivity(seed,Clock.fixed(seed.observedAt,ZoneOffset.UTC)))
}
final class ActivityPostgresTest extends ActivityContract {
  import ActivityTestData.*
  def withIndex(seed: Seed)(f: ActivityIndex => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped: set CHRONICLE_TEST_JDBC for Activity adapter verification")
    }
    val config=Fixtures.config(); val admin=new Database(config)
    val schema="activity_test_"+UUID.randomUUID().toString.replace("-","")
    admin.transaction(c => Sql.exec(c,s"CREATE SCHEMA $schema"))
    try {
      val separator=if(config.jdbcUrl.contains("?")) "&" else "?"
      val db=new Database(config.copy(jdbcUrl=config.jdbcUrl+separator+"currentSchema="+schema))
      db.transaction { c =>
        val ddl="""CREATE TABLE ch_users(id text PRIMARY KEY,login text UNIQUE NOT NULL,enabled boolean NOT NULL,credential text NOT NULL);
          CREATE TABLE ch_sources(id uuid PRIMARY KEY,owner text REFERENCES ch_users(id),source_key text NOT NULL,revision integer NOT NULL,published uuid,tombstone boolean NOT NULL,UNIQUE(owner,source_key));
          CREATE TABLE ch_revisions(session_id uuid REFERENCES ch_sources(id),revision integer,snapshot jsonb NOT NULL,PRIMARY KEY(session_id,revision));
          CREATE TABLE ch_revision_info(session_id uuid,revision integer,metadata jsonb NOT NULL,source jsonb NOT NULL,completion text NOT NULL,redacted boolean NOT NULL,last_timestamp text,last_timestamp_order numeric,message_count integer NOT NULL,PRIMARY KEY(session_id,revision),FOREIGN KEY(session_id,revision) REFERENCES ch_revisions(session_id,revision) ON DELETE CASCADE);
          CREATE TABLE ch_generations(id uuid PRIMARY KEY,session_id uuid,revision integer,profile text);
          CREATE TABLE ch_jobs(id uuid PRIMARY KEY,session_id uuid REFERENCES ch_sources(id),revision integer NOT NULL,profile text NOT NULL,state text NOT NULL,attempts integer NOT NULL,fence bigint NOT NULL,lease_until timestamptz,error text,completed_windows integer NOT NULL,total_windows integer,UNIQUE(session_id,revision,profile));
          CREATE TABLE ch_profile(singleton boolean PRIMARY KEY CHECK(singleton),active text NOT NULL,target text NOT NULL,maintenance boolean NOT NULL);
          CREATE TABLE ch_collector_progress(owner text REFERENCES ch_users(id),collector_id text,sequence bigint NOT NULL CHECK(sequence>0),report jsonb NOT NULL,received_at timestamptz NOT NULL,PRIMARY KEY(owner,collector_id));
          CREATE TABLE ch_groups(id uuid PRIMARY KEY,owner text REFERENCES ch_users(id),name text NOT NULL);
          CREATE TABLE ch_members(group_id uuid REFERENCES ch_groups(id),user_id text REFERENCES ch_users(id),PRIMARY KEY(group_id,user_id));"""
        scala.util.Using.resource(c.createStatement())(_.execute(ddl))
        List("a","b","c").foreach(owner => Sql.exec(c,"INSERT INTO ch_users VALUES(?,?,?,'synthetic')",owner,owner,!seed.disabled.contains(owner)))
        Sql.exec(c,"INSERT INTO ch_profile VALUES(true,?,?,false)",old,target)
        Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','shared')",id(1000))
        List("a","b").foreach(owner => Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",id(1000),owner))
        seed.heads.foreach { h =>
          Sql.exec(c,"INSERT INTO ch_sources VALUES(?,?,?,?,NULL,?)",h.id,h.owner,h.id.toString,h.revision,h.tombstone)
          (1 to h.revision).foreach { revision =>
            Sql.exec(c,"INSERT INTO ch_revisions VALUES(?,?,?::jsonb)",h.id,revision,"{\"notAnIngestRequest\":true,\"files\":[\"must not decode snapshots\"]}")
            val metadataJson=Wire.encode(Metadata.codecJson,metadata(h,revision)).noSpaces
            val sourceJson=Wire.encode(SourceIdentity.codecJson,source(h,revision)).noSpaces
            val at=activity(h,revision)
            val timestamp=at.fold("NULL")(_ => "?")
            val numeric=at.fold("NULL")(_ => "?::numeric")
            val params=List[Sql.Param](h.id,revision,metadataJson,sourceJson)++at.toList.flatMap(t => List[Sql.Param](t.toString,ArchiveProjection.timestampOrder(t)))
            Sql.exec(c,s"INSERT INTO ch_revision_info VALUES(?,?,?::jsonb,?::jsonb,'Quiescent',false,$timestamp,$numeric,0)",params*)
          }
        }
        seed.jobs.foreach { j =>
          val i=j.info
          val lease=j.lease.fold("NULL")(_ => "?::timestamptz")
          val error=i.error.fold("NULL")(_ => "?")
          val windows=i.totalWindows.fold("NULL")(_ => "?")
          val params=List[Sql.Param](i.id,i.sessionId,i.revision,j.profile,i.state.toString,i.attempts)++j.lease.map(_.toString).toList++i.error.toList++List[Sql.Param](i.completedWindows)++i.totalWindows.toList
          Sql.exec(c,s"INSERT INTO ch_jobs(id,session_id,revision,profile,state,attempts,fence,lease_until,error,completed_windows,total_windows) VALUES(?,?,?,?,?,?,1,$lease,$error,?,$windows)",params*)
        }
        seed.reports.foreach { r => Sql.exec(c,"INSERT INTO ch_collector_progress VALUES(?,?,?,?::jsonb,?::timestamptz)",r.owner,r.value.collectorId,r.value.sequence,Wire.encode(CollectorProgressUpdate.codecJson,r.value).noSpaces,r.received.toString) }
      }
      f(new PostgresActivity(db,Clock.fixed(seed.observedAt,ZoneOffset.UTC)))
    } finally admin.transaction(c => Sql.exec(c,s"DROP SCHEMA $schema CASCADE"))
  }
  test("Behavioral-Blackbox GoodCommunication specified: Unicode matching lowercases each entire metadata value before literal LIKE") {
    val marks="\u0345"*3000
    val heads=(1 to 5).map(n => head(n,"a",1,s"unicode-$n",false)).toList.map { h =>
      val title=h.id.getLeastSignificantBits match { case 1 => "aΣ"+marks+"b"; case 2 => "aΣ"+marks+" "; case 3 => "literal%_\\value"; case 4 => "aσ"+marks+"a"; case _ => "aσ" }
      h.copy(metadata=h.metadata.copy(title=title))
    }
    val jobs=(1 to 5).map(n => job(n,n,1,target,JobState.Queued,None)).toList
    withIndex(Seed(heads,jobs,Nil,Set.empty,now)) { index =>
      val query=jobsQuery(None,ActivityJobScope.All,None,100)
      assertEquals(index.jobs("a",query.copy(expression="σ")).jobs.map(_.job.id),List(id(1),id(4),id(5)))
      assertEquals(index.jobs("a",query.copy(expression="ς")).jobs.map(_.job.id),List(id(2)))
      assertEquals(allJobs(index,query.copy(sort=ActivityJobSort.Title,limit=1)).map(_.job.id),List(id(2),id(5),id(4),id(1),id(3)))
      assertEquals(allJobs(index,query.copy(sort=ActivityJobSort.Title,direction=SortDirection.Desc,limit=1)).map(_.job.id),List(id(3),id(1),id(4),id(5),id(2)))
      assertEquals(index.jobs("a",query.copy(expression=Json.fromString("%_\\").noSpaces)).jobs.map(_.job.id),List(id(3)))
    }
  }

}

private final class DummyActivity(seed: ActivityTestData.Seed,clock: Clock) extends ActivityIndex {
  import ActivityTestData.*
  private enum Value { case Text(value: String); case Number(value: BigDecimal) }
  private def visible(owner: String): List[Head] = {
    Check(Set("a","b","c").contains(owner) && !seed.disabled.contains(owner),"unauthorized","owner disabled")
    seed.heads.filter(h => h.owner==owner && !h.tombstone)
  }
  private def collector(h: Head): String = seed.reports.filter(r => r.owner==h.owner && (h.namespace==r.value.collectorId || h.namespace.startsWith(r.value.collectorId+"/"))).maxByOption(_.value.collectorId.length).fold(h.namespace)(_.value.collectorId)
  private def rows(owner: String,now: Instant): List[ActivityJob] = seed.jobs.flatMap { j => visible(owner).find(_.id==j.info.sessionId).map { h =>
    val classification=(j.info.revision==h.revision,j.profile==target) match {
      case (true,true) => ActivityJobClass.Current
      case (false,true) => ActivityJobClass.SupersededRevision
      case (true,false) => ActivityJobClass.ObsoleteProfile
      case (false,false) => ActivityJobClass.SupersededRevisionAndProfile
    }
    ActivityJob(j.info,j.profile,classification,j.lease.map(_.toString),j.info.state==JobState.Running && j.lease.exists(_.isAfter(now)),classification==ActivityJobClass.Current && j.info.state==JobState.Failed,collector(h),session(h,j.info.revision),activity(h,j.info.revision).map(_.toString))
  }}
  private def counts(rows: List[ActivityJob]): JobCounts = {
    def state(s: JobState): Long = rows.count(_.job.state==s).toLong
    val running=rows.filter(_.job.state==JobState.Running)
    JobCounts(rows.size.toLong,state(JobState.Queued),state(JobState.Running),state(JobState.Failed),state(JobState.Complete),running.count(_.leaseActive).toLong,running.count(j => j.leaseExpiresAt.nonEmpty && !j.leaseActive).toLong,running.count(_.leaseExpiresAt.isEmpty).toLong)
  }
  // PostgreSQL Unicode-provider edge cases are verified on the real adapter, not this JVM approximation.
  private def fold(value: String): String = value.toLowerCase(java.util.Locale.ROOT)
  private def equal(value: Option[String],expected: String): Boolean = value.exists(v => fold(v)==fold(expected))
  private def substring(values: List[String],expected: String): Boolean = values.exists(v => fold(v).contains(fold(expected)))
  private def lease(j: ActivityJob): String = if(j.leaseExpiresAt.isEmpty) "unleased" else if(j.job.state!=JobState.Running) "inactive" else if(j.leaseActive) "active" else "expired"
  private def freshness(c: ActivityCollector): String = c.status.fold("unknown")(s => if(s.stale) "stale" else "recent")
  private def jobPredicate(j: ActivityJob,p: ActivityJobPredicate): Boolean = p match {
    case ActivityJobPredicate.Source(p) => p match {
      case ArchivePredicate.User(v) => j.session.ownerId==v
      case ArchivePredicate.Tag(v) => j.session.metadata.tags.exists(t => equal(Some(t),v))
      case ArchivePredicate.Project(v) => equal(j.session.metadata.project,v)
      case ArchivePredicate.Branch(v) => equal(j.session.metadata.gitBranch,v)
      case ArchivePredicate.Producer(v) => equal(Some(j.session.metadata.producer),v)
      case ArchivePredicate.Model(v) => equal(j.session.metadata.model,v)
      case ArchivePredicate.Format(v) => j.session.source.format==v
      case ArchivePredicate.Status(v) => j.job.state.toString==v.toString
      case ArchivePredicate.After(v) => j.lastTimestamp.exists(t => !Instant.parse(t).isBefore(v))
      case ArchivePredicate.Before(v) => j.lastTimestamp.exists(t => Instant.parse(t).isBefore(v))
    }
    case ActivityJobPredicate.Collector(v) => j.collectorId==v
    case ActivityJobPredicate.Profile(v) => j.profile==v
    case ActivityJobPredicate.Classification(v) => j.classification==v
    case ActivityJobPredicate.Reason(v) => equal(j.job.error,v)
    case ActivityJobPredicate.Lease(v) => lease(j)==fold(v.toString)
  }
  private def collectorPredicate(c: ActivityCollector,p: ActivityCollectorPredicate): Boolean = p match {
    case ActivityCollectorPredicate.Collector(v) => c.collectorId==v
    case ActivityCollectorPredicate.Phase(v) => c.status.exists(_.report.phase==v)
    case ActivityCollectorPredicate.Freshness(v) => freshness(c)==fold(v.toString)
    case ActivityCollectorPredicate.After(v) => c.status.exists(s => !Instant.parse(s.receivedAt).isBefore(v))
    case ActivityCollectorPredicate.Before(v) => c.status.exists(s => Instant.parse(s.receivedAt).isBefore(v))
  }
  private def jobText(j: ActivityJob,value: String): Boolean = substring(List(j.job.id.toString,j.job.sessionId.toString,j.collectorId,j.job.state.toString,j.job.revision.toString,j.profile,j.job.attempts.toString,j.job.completedWindows.toString,j.classification.toString,lease(j),j.session.metadata.title,j.session.metadata.producer,j.session.source.format.toString)++j.job.totalWindows.map(_.toString)++j.job.error++j.lastTimestamp++j.session.metadata.project++j.session.metadata.gitBranch++j.session.metadata.model++j.session.metadata.tags,value)
  private def collectorText(c: ActivityCollector,value: String): Boolean = substring(List(c.collectorId,freshness(c))++c.status.map(_.report.phase.toString)++c.status.flatMap(_.report.error),value)
  private def text(value: String): Option[Value] = Some(Value.Text(value))
  private def number(value: Long): Option[Value] = Some(Value.Number(BigDecimal(value)))
  private def time(value: Option[String]): Option[Value] = value.map(t => Value.Number(BigDecimal(ArchiveProjection.timestampOrder(Instant.parse(t)))))
  private def jobKey(j: ActivityJob,sort: ActivityJobSort): Option[Value] = sort match {
    case ActivityJobSort.LastTimestamp => time(j.lastTimestamp)
    case ActivityJobSort.Title => text(fold(j.session.metadata.title))
    case ActivityJobSort.Collector => text(j.collectorId)
    case ActivityJobSort.State => text(fold(j.job.state.toString))
    case ActivityJobSort.Revision => number(j.job.revision)
    case ActivityJobSort.Profile => text(j.profile)
    case ActivityJobSort.Attempts => number(j.job.attempts)
    case ActivityJobSort.CompletedWindows => number(j.job.completedWindows)
    case ActivityJobSort.TotalWindows => j.job.totalWindows.flatMap(v => number(v))
    case ActivityJobSort.LeaseExpiresAt => time(j.leaseExpiresAt)
    case ActivityJobSort.LeaseState => text(lease(j))
    case ActivityJobSort.Reason => j.job.error.flatMap(v => text(fold(v)))
    case ActivityJobSort.Classification => text(fold(j.classification.toString))
    case ActivityJobSort.JobId => text(j.job.id.toString)
    case ActivityJobSort.SessionId => text(j.job.sessionId.toString)
  }
  private def collectorKey(c: ActivityCollector,sort: ActivityCollectorSort): Option[Value] = sort match {
    case ActivityCollectorSort.CollectorId => text(c.collectorId)
    case ActivityCollectorSort.Phase => c.status.flatMap(s => text(fold(s.report.phase.toString)))
    case ActivityCollectorSort.Freshness => text(freshness(c))
    case ActivityCollectorSort.ReceivedAt => time(c.status.map(_.receivedAt))
    case ActivityCollectorSort.ArchiveHeads => number(c.archiveHeads)
    case ActivityCollectorSort.HeadsWithoutTargetJob => number(c.headsWithoutTargetJob)
    case ActivityCollectorSort.CurrentTotal => number(c.current.total)
    case ActivityCollectorSort.CurrentQueued => number(c.current.queued)
    case ActivityCollectorSort.CurrentRunning => number(c.current.running)
    case ActivityCollectorSort.CurrentFailed => number(c.current.failed)
    case ActivityCollectorSort.CurrentComplete => number(c.current.complete)
    case ActivityCollectorSort.CurrentActiveRunning => number(c.current.activeRunning)
    case ActivityCollectorSort.CurrentExpiredRunning => number(c.current.expiredRunning)
    case ActivityCollectorSort.CurrentUnleasedRunning => number(c.current.unleasedRunning)
    case ActivityCollectorSort.HistoricalTotal => number(c.historical.total)
    case ActivityCollectorSort.HistoricalQueued => number(c.historical.queued)
    case ActivityCollectorSort.HistoricalRunning => number(c.historical.running)
    case ActivityCollectorSort.HistoricalFailed => number(c.historical.failed)
    case ActivityCollectorSort.HistoricalComplete => number(c.historical.complete)
    case ActivityCollectorSort.HistoricalActiveRunning => number(c.historical.activeRunning)
    case ActivityCollectorSort.HistoricalExpiredRunning => number(c.historical.expiredRunning)
    case ActivityCollectorSort.HistoricalUnleasedRunning => number(c.historical.unleasedRunning)
  }
  private def compareText(left: String,right: String): Int = java.util.Arrays.compareUnsigned(left.getBytes(UTF_8),right.getBytes(UTF_8))
  private def compare(left: Option[Value],right: Option[Value],direction: SortDirection): Int = (left,right) match {
    case (None,None) => 0
    case (None,_) => 1
    case (_,None) => -1
    case (Some(a),Some(b)) =>
      val result=(a,b) match {
        case (Value.Text(a),Value.Text(b)) => compareText(a,b)
        case (Value.Number(a),Value.Number(b)) => a.compare(b)
        case _ => throw new AssertionError("mixed cursor key domains")
      }
      if(direction==SortDirection.Asc) result else -result
  }
  private def wire(value: Option[Value]): Option[String] = value.map { case Value.Text(v) => v; case Value.Number(v) => v.bigDecimal.toPlainString }
  private def position(value: ActivityPosition,kind: ActivityPositionKind): Option[Value] = value.value.map { v => if(kind==ActivityPositionKind.Count || kind==ActivityPositionKind.Time) Value.Number(BigDecimal(v)) else Value.Text(v) }
  private def jobOrder(sort: ActivityJobSort): ActivityOrder = sort match {
    case ActivityJobSort.LastTimestamp | ActivityJobSort.LeaseExpiresAt => ActivityOrder("",ActivityPositionKind.Time,true)
    case ActivityJobSort.TotalWindows => ActivityOrder("",ActivityPositionKind.Count,true)
    case ActivityJobSort.Revision | ActivityJobSort.Attempts | ActivityJobSort.CompletedWindows => ActivityOrder("",ActivityPositionKind.Count,false)
    case ActivityJobSort.State => ActivityOrder("",ActivityPositionKind.State,false)
    case ActivityJobSort.LeaseState => ActivityOrder("",ActivityPositionKind.Lease,false)
    case ActivityJobSort.Classification => ActivityOrder("",ActivityPositionKind.Classification,false)
    case ActivityJobSort.JobId | ActivityJobSort.SessionId => ActivityOrder("",ActivityPositionKind.Uuid,false)
    case ActivityJobSort.Reason => ActivityOrder("",ActivityPositionKind.Text,true)
    case _ => ActivityOrder("",ActivityPositionKind.Text,false)
  }
  private def collectorOrder(sort: ActivityCollectorSort): ActivityOrder = sort match {
    case ActivityCollectorSort.CollectorId => ActivityOrder("",ActivityPositionKind.Text,false)
    case ActivityCollectorSort.Phase => ActivityOrder("",ActivityPositionKind.Phase,true)
    case ActivityCollectorSort.Freshness => ActivityOrder("",ActivityPositionKind.Freshness,false)
    case ActivityCollectorSort.ReceivedAt => ActivityOrder("",ActivityPositionKind.Time,true)
    case _ => ActivityOrder("",ActivityPositionKind.Count,false)
  }
  def summary(user: UserInfo,q: ActivityQuery): ActivityResult = {
    ActivityCursor.page(q.limit)
    val expression=ActivityExpression.collectors(q.expression); val order=collectorOrder(q.sort)
    val after=ActivityCursor.collector(q,user.id,order)
    val now=clock.instant(); val heads=visible(user.id); val jobs=rows(user.id,now)
    val reports=seed.reports.filter(_.owner==user.id)
    val current=jobs.filter(_.classification==ActivityJobClass.Current); val historical=jobs.filterNot(_.classification==ActivityJobClass.Current)
    val names=(heads.map(collector)++reports.map(_.value.collectorId)).distinct
    val collectors=names.map { name =>
      val ownHeads=heads.filter(h => collector(h)==name); val ownJobs=jobs.filter(_.collectorId==name)
      ActivityCollector(name,reports.find(_.value.collectorId==name).map(r => CollectorStatus(r.value,r.received.toString,now.isAfter(r.received.plusSeconds(CollectorProgress.staleSeconds)))),ownHeads.size.toLong,ownHeads.count(h => !current.exists(_.job.sessionId==h.id)).toLong,counts(ownJobs.filter(_.classification==ActivityJobClass.Current)),counts(ownJobs.filterNot(_.classification==ActivityJobClass.Current)))
    }.filter(c => expression.evaluate(value => collectorText(c,value),p => collectorPredicate(c,p))).sortWith { (a,b) =>
      val compared=compare(collectorKey(a,q.sort),collectorKey(b,q.sort),q.direction)
      compared<0 || (compared==0 && compareText(a.collectorId,b.collectorId)<0)
    }
    val remaining=collectors.filter(c => after.forall { p => val compared=compare(collectorKey(c,q.sort),position(p,order.kind),q.direction); compared>0 || (compared==0 && compareText(c.collectorId,p.id)>0) })
    val selected=remaining.take(q.limit)
    val next=if(remaining.size>q.limit) Some(ActivityCursor.encodeCollector(q,user.id,order,ActivityPosition(wire(collectorKey(selected.last,q.sort)),selected.last.collectorId))) else None
    ActivityResult(now.toString,user,heads.size.toLong,heads.count(h => !current.exists(_.job.sessionId==h.id)).toLong,counts(current),counts(historical),selected,collectors.size.toLong,names.size.toLong,next)
  }
  def jobs(owner: String,q: ActivityJobsQuery): ActivityJobsResult = {
    ActivityCursor.page(q.limit); q.collectorId.foreach(ActivityCursor.collectorId)
    val expression=ActivityExpression.jobs(q.expression); val order=jobOrder(q.sort); val after=ActivityCursor.job(q,owner,order)
    val now=clock.instant()
    val filtered=rows(owner,now).filter { j => q.collectorId.forall(_==j.collectorId) && (q.scope match {
      case ActivityJobScope.All => true
      case ActivityJobScope.Current => j.classification==ActivityJobClass.Current
      case ActivityJobScope.Historical => j.classification!=ActivityJobClass.Current
    }) && expression.evaluate(value => jobText(j,value),p => jobPredicate(j,p)) }.sortWith { (a,b) =>
      val compared=compare(jobKey(a,q.sort),jobKey(b,q.sort),q.direction)
      compared<0 || (compared==0 && a.job.id.toString<b.job.id.toString)
    }
    val remaining=filtered.filter(j => after.forall { p => val compared=compare(jobKey(j,q.sort),position(p,order.kind),q.direction); compared>0 || (compared==0 && j.job.id.toString>p.id) })
    val selected=remaining.take(q.limit)
    val next=if(remaining.size>q.limit) Some(ActivityCursor.encodeJob(q,owner,order,ActivityPosition(wire(jobKey(selected.last,q.sort)),selected.last.job.id.toString))) else None
    ActivityJobsResult(now.toString,selected,filtered.size.toLong,next)
  }
}
