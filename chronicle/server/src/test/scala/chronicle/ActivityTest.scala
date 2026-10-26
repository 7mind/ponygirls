package chronicle
import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.{Clock,Instant,ZoneOffset}
import java.util.{Base64,UUID}
import scala.util.Try

private object ActivityTestData {
  val now=Instant.parse("2026-10-26T10:00:00Z")
  val user=UserInfo("a","owner",List(Scope.Read))
  val target="target-profile"
  val old="old-profile"
  val empty=JobCounts(0,0,0,0,0,0,0,0)
  def collectorQuery(cursor: Option[String],limit: Int): ActivityQuery = ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,cursor,limit)
  def jobsQuery(collectorId: Option[String],scope: ActivityJobScope,cursor: Option[String],limit: Int): ActivityJobsQuery = ActivityJobsQuery(collectorId,scope,"",ActivityJobSort.JobId,SortDirection.Asc,cursor,limit)
  def metadata(revision: Int): Metadata = Fixtures.snapshot().metadata.copy(title=s"revision-$revision")
  def source(head: Head,revision: Int): SourceIdentity = SourceIdentity(if(revision==head.revision) head.namespace else "wrong-old-namespace","native",SourceFormat.Pi,head.id.toString,None)
  def session(head: Head,revision: Int): SessionInfo = SessionInfo(ContentView(revision,None),head.id,head.owner,head.revision,None,metadata(revision),source(head,revision),Completion.Quiescent,false)

  final case class Head(id: UUID,owner: String,revision: Int,namespace: String,tombstone: Boolean)
  final case class Job(info: JobInfo,profile: String,lease: Option[Instant])
  final case class Report(owner: String,value: CollectorProgressUpdate,received: Instant)
  final case class Seed(heads: List[Head],jobs: List[Job],reports: List[Report],disabled: Set[String],observedAt: Instant)
  def id(n: Int): UUID = new UUID(0,n.toLong)
  def head(n: Int,owner: String,revision: Int,namespace: String,tombstone: Boolean): Head = Head(id(n),owner,revision,namespace,tombstone)
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
  def allCollectors(index: ActivityIndex,limit: Int): List[ActivityCollector] = {
    val out=List.newBuilder[ActivityCollector]
    var cursor: Option[String]=None
    var pages=0
    var more=true
    while(more) {
      val page=index.summary(user,collectorQuery(cursor,limit))
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
      val malformedId=Base64.getUrlEncoder.withoutPadding.encodeToString(Json.fromValues(fields.updated(4,value)).noSpaces.getBytes(UTF_8))
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
            val metadataJson=Wire.encode(Metadata.codecJson,metadata(revision)).noSpaces
            val sourceJson=Wire.encode(SourceIdentity.codecJson,source(h,revision)).noSpaces
            Sql.exec(c,"INSERT INTO ch_revision_info VALUES(?,?,?::jsonb,?::jsonb,'Quiescent',false,NULL,NULL,0)",h.id,revision,metadataJson,sourceJson)
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
}

private final class DummyActivity(seed: ActivityTestData.Seed,clock: Clock) extends ActivityIndex {
  import ActivityTestData.*
  private def visible(owner: String): List[Head] = {
    Check(Set("a","b","c").contains(owner) && !seed.disabled.contains(owner),"unauthorized","owner disabled")
    seed.heads.filter(h => h.owner==owner && !h.tombstone)
  }
  private def collector(h: Head): String = seed.reports.filter { r =>
    r.owner==h.owner && (h.namespace==r.value.collectorId || h.namespace.startsWith(r.value.collectorId+"/"))
  }.maxByOption(_.value.collectorId.length).fold(h.namespace)(_.value.collectorId)
  private def rows(owner: String,now: Instant): List[(String,ActivityJob)] = {
    val heads=visible(owner)
    seed.jobs.flatMap { j => heads.find(_.id==j.info.sessionId).map { h =>
      val classification=(j.info.revision==h.revision,j.profile==target) match {
        case (true,true) => ActivityJobClass.Current
        case (false,true) => ActivityJobClass.SupersededRevision
        case (true,false) => ActivityJobClass.ObsoleteProfile
        case (false,false) => ActivityJobClass.SupersededRevisionAndProfile
      }
      collector(h)->ActivityJob(j.info,j.profile,classification,j.lease.map(_.toString),j.info.state==JobState.Running && j.lease.exists(_.isAfter(now)),classification==ActivityJobClass.Current && j.info.state==JobState.Failed,collector(h),session(h,j.info.revision),None)
    }}
  }
  private def counts(rows: List[ActivityJob],now: Instant): JobCounts = {
    def state(s: JobState): Long = rows.count(_.job.state==s).toLong
    val running=rows.filter(_.job.state==JobState.Running)
    JobCounts(rows.size.toLong,state(JobState.Queued),state(JobState.Running),state(JobState.Failed),state(JobState.Complete),running.count(_.leaseActive).toLong,running.count(_.leaseExpiresAt.exists(at => !Instant.parse(at).isAfter(now))).toLong,running.count(_.leaseExpiresAt.isEmpty).toLong)
  }
  private def page(limit: Int): Unit = Check(limit>0 && limit<=100,"invalid","page bounds")
  private def identifier(value: String): Unit = Check(value.nonEmpty && value.length<=256 && !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value),"invalid","collector ID")
  private def compareCollectors(left: String,right: String): Int = java.util.Arrays.compareUnsigned(left.getBytes(UTF_8),right.getBytes(UTF_8))
  private def token(fields: List[String]): String = Base64.getUrlEncoder.withoutPadding.encodeToString(Json.arr(fields.map(Json.fromString)*).noSpaces.getBytes(UTF_8))
  private def untoken(value: String): List[String] = {
    Check(value.nonEmpty && value.length<=8192,"invalid","cursor")
    Try(Wire.parse(new String(Base64.getUrlDecoder.decode(value),UTF_8)).as[List[String]].toOption.get).getOrElse(throw DomainError("invalid","cursor"))
  }
  def summary(user: UserInfo,q: ActivityQuery): ActivityResult = {
    page(q.limit)
    val after=q.cursor.map { value =>
      val fields=untoken(value)
      Check(fields.size==3 && fields.head=="collectors" && fields(1)==user.id,"invalid","cursor binding")
      identifier(fields(2)); fields(2)
    }
    val now=clock.instant(); val heads=visible(user.id); val jobs=rows(user.id,now)
    val reports=seed.reports.filter(_.owner==user.id)
    val current=jobs.map(_._2).filter(_.classification==ActivityJobClass.Current)
    val historical=jobs.map(_._2).filterNot(_.classification==ActivityJobClass.Current)
    val names=(heads.map(collector)++reports.map(_.value.collectorId)).distinct.sortWith((a,b) => compareCollectors(a,b)<0)
    val selected=names.filter(n => after.forall(previous => compareCollectors(n,previous)>0)).take(q.limit)
    val collectors=selected.map { name =>
      val ownHeads=heads.filter(h => collector(h)==name)
      val ownJobs=jobs.filter(_._1==name).map(_._2)
      ActivityCollector(name,reports.find(_.value.collectorId==name).map(r => CollectorStatus(r.value,r.received.toString,now.isAfter(r.received.plusSeconds(120)))),ownHeads.size.toLong,ownHeads.count(h => !current.exists(_.job.sessionId==h.id)).toLong,counts(ownJobs.filter(_.classification==ActivityJobClass.Current),now),counts(ownJobs.filterNot(_.classification==ActivityJobClass.Current),now))
    }
    val next=if(names.count(n => after.forall(previous => compareCollectors(n,previous)>0))>q.limit) Some(token(List("collectors",user.id,selected.last))) else None
    ActivityResult(now.toString,user,heads.size.toLong,heads.count(h => !current.exists(_.job.sessionId==h.id)).toLong,counts(current,now),counts(historical,now),collectors,names.size.toLong,names.size.toLong,next)
  }
  def jobs(owner: String,q: ActivityJobsQuery): ActivityJobsResult = {
    page(q.limit); q.collectorId.foreach(identifier)
    val binding=List("jobs",owner,q.scope.toString,q.collectorId.fold("none")("some:"+_))
    val after=q.cursor.map { value =>
      val fields=untoken(value)
      Check(fields.size==5 && fields.take(4)==binding,"invalid","cursor binding")
      Try(UUID.fromString(fields.last)).toOption.filter(_.toString==fields.last).getOrElse(throw DomainError("invalid","cursor"))
    }
    val now=clock.instant()
    val filtered=rows(owner,now).filter { case (name,j) =>
      q.collectorId.forall(_==name) && (q.scope match {
        case ActivityJobScope.All => true
        case ActivityJobScope.Current => j.classification==ActivityJobClass.Current
        case ActivityJobScope.Historical => j.classification!=ActivityJobClass.Current
      })
    }.map(_._2).sortBy(_.job.id.toString)
    val remaining=filtered.filter(j => after.forall(_.toString<j.job.id.toString))
    val selected=remaining.take(q.limit)
    val next=if(remaining.size>q.limit) Some(token(binding:+selected.last.job.id.toString)) else None
    ActivityJobsResult(now.toString,selected,filtered.size.toLong,next)
  }
}
