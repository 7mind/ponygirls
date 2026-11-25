package chronicle

import chronicle.api.*
import java.time.{Clock,Instant,ZoneOffset}
import java.time.temporal.ChronoUnit
import java.util.UUID
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}

/** Activity's claim-order view (claim-order spec §7, design note §6, B6) on the full schema: why a job is not running, its
  * waiting age and class, the per-class counts of the owner's own jobs, and "N ahead" — the only value that reads other
  * owners' jobs, as a count. Every order comes from stored fixture values; the read is evaluated at a fixed observation
  * instant, so leases and back-offs are stored relative to it. */
final class ActivityClaimOrderTest extends munit.FunSuite {
  private val now=Instant.now().truncatedTo(ChronoUnit.SECONDS)
  private def minutes(n: Long): Instant = now.plusSeconds(n*60)
  private final case class Fixture(config: Config,db: Database,archive: PostgresArchive)
  private final case class Row(owner: String,session: UUID,job: UUID,title: String,identity: SourceIdentity)
  private def withFixture(run: Fixture => Unit): Unit = OwnerProfilePostgres.withDatabase { (config,db,archive,_) =>
    val owners=List("a","b","c")
    def store(c: java.sql.Connection) = IndexingPreferenceSql.store(c,IndexingService.Chronicle,config.indexingPolicy)
    val before=db.transaction(c => owners.map(o => o -> store(c).get(o)))
    try run(Fixture(config,db,archive))
    finally db.transaction { c => before.foreach { (o,p) => val s=store(c); s.setChoice(o,p.choice); s.setOverride(o,p.overrideChoice) } }
  }
  private def source(f: Fixture,owner: String,title: String): Row = {
    val base=Fixtures.snapshot()
    val receipt=f.archive.ingest(owner,base.copy(metadata=base.metadata.copy(title=title)))
    Row(owner,receipt.sessionId,receipt.jobId,title,base.source)
  }
  /** Revision 2 of `row`'s source (other content); returns its job. */
  private def revise(f: Fixture,row: Row): Row = {
    val base=Fixtures.snapshot()
    val text="synthetic second revision"
    val raw=base.files.head.content.replace(base.messages.head.text,text)
    val request=base.copy(source=row.identity,expectedRevision=1,digest=Wire.hash(raw),files=List(base.files.head.copy(content=raw,sha256=Wire.hash(raw))),
      metadata=base.metadata.copy(title=row.title),messages=List(base.messages.head.copy(text=text)))
    val receipt=f.archive.ingest(row.owner,request)
    assertEquals(receipt.revision,2)
    row.copy(job=receipt.jobId)
  }
  private def epoch(f: Fixture,owner: String): Long = f.db.transaction(c => ChronicleIndexing.read(c,f.db.indexingDefaultEnabled,owner).epoch)
  /** Stores a job row exactly: state, lease, attempts, waiting age, class, window count and its indexing epoch (the owner's
    * current one, unless `invalidated`). */
  private def set(f: Fixture,row: Row,state: JobState,lease: Option[Instant]=None,attempts: Int=0,waiting: Option[Instant]=None,bulk: Option[Boolean]=Some(false),total: Option[Int]=None,invalidated: Boolean=false): Unit = {
    val e=epoch(f,row.owner)+(if(invalidated) 7 else 0)
    f.db.transaction { c =>
      val args=List[Sql.Param](state.toString,attempts,e)++lease.map(_.toString).toList++waiting.map(_.toString).toList++bulk.toList++total.toList++List[Sql.Param](row.job)
      Sql.exec(c,s"""UPDATE ch_jobs SET state=?,attempts=?,indexing_epoch=?,lease_until=${lease.fold("NULL")(_ => "?::timestamptz")},
        waiting_since=${waiting.fold("NULL")(_ => "?::timestamptz")},bulk=${bulk.fold("NULL")(_ => "?")},total_windows=${total.fold("NULL")(_ => "?")} WHERE id=?""",args*)
    }
  }
  private def preference(f: Fixture,owner: String,choice: IndexingChoice): Unit =
    f.db.transaction(c => IndexingPreferenceSql.store(c,IndexingService.Chronicle,f.config.indexingPolicy).setChoice(owner,choice))
  private def activity(f: Fixture,mode: ClaimOrderMode): PostgresActivity = new PostgresActivity(f.db,Clock.fixed(now,ZoneOffset.UTC),mode)
  private val waiting=ClaimOrderMode.Waiting(1)
  private def query(scope: ActivityJobScope=ActivityJobScope.All): ActivityJobsQuery = ActivityJobsQuery(None,scope,"",ActivityJobSort.JobId,SortDirection.Asc,None,100)
  private def jobs(f: Fixture,mode: ClaimOrderMode,owner: String): Map[UUID,ActivityJob] = activity(f,mode).jobs(owner,query()).jobs.map(j => j.job.id -> j).toMap
  private def summary(f: Fixture,mode: ClaimOrderMode,owner: String): ActivityResult =
    activity(f,mode).summary(UserInfo(owner,owner,List(Scope.Read)),ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,100))

  test("defaults: today's claim order unless configured") {
    assertEquals(ClaimOrderMode.of(Fixtures.config()),ClaimOrderMode.SourceId)
  }

  test("every waiting reason from the stored row, a Running row with an ended lease never reported as running, the size reason by the claim order") { withFixture { f =>
    val queued=source(f,"a","queued"); val held=source(f,"a","held"); val sized=source(f,"a","sized"); val expired=source(f,"a","expired")
    val exhausted=source(f,"a","exhausted"); val invalidated=source(f,"a","invalidated"); val running=source(f,"a","running")
    val failed=source(f,"a","failed")
    set(f,queued,JobState.Queued,waiting=Some(minutes(-50)))
    set(f,held,JobState.Queued,lease=Some(minutes(30)),attempts=2,waiting=Some(minutes(-40)))
    set(f,sized,JobState.Queued,waiting=Some(minutes(-30)),bulk=Some(true),total=Some(150))
    set(f,expired,JobState.Running,lease=Some(minutes(-5)),attempts=2,waiting=Some(minutes(-20)))
    set(f,exhausted,JobState.Running,lease=Some(minutes(-5)),attempts=Jobs.attemptLimit,waiting=Some(minutes(-10)))
    set(f,invalidated,JobState.Running,lease=Some(minutes(10)),attempts=1,waiting=Some(minutes(-8)),invalidated=true)
    set(f,running,JobState.Running,lease=Some(minutes(10)),attempts=1,waiting=Some(minutes(-6)))
    set(f,failed,JobState.Failed,attempts=5,waiting=Some(minutes(-4)))
    // A source whose older revision is still Running with a valid lease: its next revision's job waits for it, and the
    // older job is not current.
    val blocked=source(f,"a","blocked")
    set(f,blocked,JobState.Running,lease=Some(Instant.now().plusSeconds(3600)),attempts=1,waiting=Some(minutes(-3)))
    val blockedHead=revise(f,blocked)
    set(f,blockedHead,JobState.Queued,waiting=Some(minutes(-3)))
    List(ClaimOrderMode.SourceId -> ActivityJobWaiting.AwaitingLargePermit(),waiting -> ActivityJobWaiting.AwaitingLargeLane()).foreach { (mode,large) =>
      val read=jobs(f,mode,"a")
      def reason(row: Row): Option[ActivityJobWaiting] = read(row.job).waiting
      assertEquals(reason(queued),Some(ActivityJobWaiting.Queued()),mode.toString)
      assertEquals(reason(held),Some(ActivityJobWaiting.Held(minutes(30).toString)))
      assertEquals(reason(sized),Some(large),mode.toString)
      assertEquals(reason(expired),Some(ActivityJobWaiting.LeaseExpiredAwaitingReclaim()))
      assert(!read(expired.job).leaseActive)
      assertEquals(reason(exhausted),Some(ActivityJobWaiting.LeaseExhaustedPending()))
      assert(!read(exhausted.job).leaseActive)
      assertEquals(reason(invalidated),Some(ActivityJobWaiting.AwaitingReclaim()))
      assertEquals(reason(running),None); assert(read(running.job).leaseActive)
      assertEquals(reason(failed),None)
      assertEquals(reason(blockedHead),Some(ActivityJobWaiting.BlockedByOlderRevision(1)))
      assertEquals(reason(blocked),None,"an older revision has no scheduler reason")
      assertEquals(read(queued.job).waitingSince,Some(minutes(-50).toString)); assertEquals(read(queued.job).bulk,Some(false))
      assertEquals(read(sized.job).bulk,Some(true))
      // Only candidates have a position.
      List(held,exhausted,running,failed,blockedHead).foreach(row => assertEquals(read(row.job).ahead,None,row.title))
      List(queued,sized,expired,invalidated).foreach(row => assert(read(row.job).ahead.nonEmpty,row.title))
    }
    // The older revision's lease ends: still not current, no reason; its head stays blocked until it is superseded.
    set(f,blocked,JobState.Running,lease=Some(minutes(-1)),attempts=1,waiting=Some(minutes(-3)))
    val after=jobs(f,ClaimOrderMode.SourceId,"a")
    assertEquals(after(blocked.job).waiting,None)
    assertEquals(after(blockedHead.job).waiting,Some(ActivityJobWaiting.BlockedByOlderRevision(1)))
  }}

  test("an owner whose indexing is off: IndexingOff before reclaim, hold or size, and no position") { withFixture { f =>
    val expired=source(f,"a","expired"); val invalidated=source(f,"a","invalidated"); val held=source(f,"a","held"); val sized=source(f,"a","sized")
    val queued=source(f,"a","queued")
    set(f,expired,JobState.Running,lease=Some(minutes(-5)),attempts=2,waiting=Some(minutes(-20)))
    set(f,held,JobState.Queued,lease=Some(minutes(30)),waiting=Some(minutes(-10)))
    set(f,sized,JobState.Queued,waiting=Some(minutes(-30)),total=Some(150))
    set(f,queued,JobState.Queued,waiting=Some(minutes(-40)))
    set(f,invalidated,JobState.Running,lease=Some(minutes(10)),attempts=1,waiting=Some(minutes(-8)),invalidated=true)
    preference(f,"a",IndexingChoice.Disable)
    List(ClaimOrderMode.SourceId,waiting).foreach { mode =>
      val read=jobs(f,mode,"a")
      List(expired,invalidated,held,sized,queued).foreach { row =>
        assertEquals(read(row.job).waiting,Some(ActivityJobWaiting.IndexingOff()),row.title)
        assertEquals(read(row.job).ahead,None,row.title)
      }
      val counts=summary(f,mode,"a").queue.get
      assertEquals(counts.fresh,ActivityClassQueue(5,0,0,0,Some(minutes(-40).toString)))
      assertEquals(counts.awaitingLarge,0L); assertEquals(counts.largeAhead,None)
    }
  }}

  test("the 25 Nov case: two head jobs Running with ended leases behind queued work read as awaiting reclaim, never running or queued") { withFixture { f =>
    val behind=(1 to 6).map(n => source(f,"a",s"queued-$n")).toList
    behind.zipWithIndex.foreach((row,n) => set(f,row,JobState.Queued,waiting=Some(minutes(-10L-n))))
    val small=source(f,"a","small"); val large=source(f,"a","large")
    set(f,small,JobState.Running,lease=Some(minutes(-30)),attempts=1,waiting=Some(minutes(-120)))
    set(f,large,JobState.Running,lease=Some(minutes(-30)),attempts=1,waiting=Some(minutes(-110)),total=Some(150))
    List(ClaimOrderMode.SourceId,waiting).foreach { mode =>
      val read=jobs(f,mode,"a")
      List(small,large).foreach { row =>
        val job=read(row.job)
        assertEquals(job.waiting,Some(ActivityJobWaiting.LeaseExpiredAwaitingReclaim()),row.title)
        assertEquals(job.job.state,JobState.Running); assert(!job.leaseActive)
      }
      val counts=summary(f,mode,"a")
      assertEquals(counts.current.activeRunning,0L)
      assertEquals(counts.queue.get.fresh,ActivityClassQueue(8,8,0,2,Some(minutes(-120).toString)))
    }
    // Waiting: the oldest of their class. Both are fresh: the small one first, the large one behind it.
    val ordered=jobs(f,waiting,"a")
    assertEquals(ordered(small.job).ahead,Some(0L)); assertEquals(ordered(large.job).ahead,Some(1L))
    assertEquals(behind.map(row => ordered(row.job).ahead.get),List(2L,3L,4L,5L,6L,7L).reverse)
  }}

  /** Owner `a`'s jobs, and owner `b`'s planted ahead of them in every order: `b`'s jobs are older, and "b" sorts after
    * "a" only in today's owner order. */
  private final case class Planted(a: Map[String,Row],b: Map[String,Row])
  private def plantA(f: Fixture): Map[String,Row] = {
    val rows=List("a-fresh","a-bulk","a-reclaim","a-sized","a-held","a-unclassified").map(t => t -> source(f,"a",t)).toMap
    set(f,rows("a-fresh"),JobState.Queued,waiting=Some(minutes(-10)))
    set(f,rows("a-bulk"),JobState.Queued,waiting=Some(minutes(-20)),bulk=Some(true))
    set(f,rows("a-reclaim"),JobState.Running,lease=Some(minutes(-1)),attempts=1,waiting=Some(minutes(-30)))
    set(f,rows("a-sized"),JobState.Queued,waiting=Some(minutes(-5)),bulk=Some(true),total=Some(150))
    set(f,rows("a-held"),JobState.Queued,lease=Some(minutes(20)),waiting=Some(minutes(-60)))
    set(f,rows("a-unclassified"),JobState.Queued,waiting=None,bulk=None)
    rows
  }
  private def plantB(f: Fixture): Map[String,Row] = {
    val rows=List("b-fresh-old","b-fresh-mid","b-bulk","b-sized","b-fresh-new","b-held").map(t => t -> source(f,"b",t)).toMap
    set(f,rows("b-fresh-old"),JobState.Queued,waiting=Some(minutes(-40)))
    set(f,rows("b-fresh-mid"),JobState.Queued,waiting=Some(minutes(-15)))
    set(f,rows("b-bulk"),JobState.Queued,waiting=Some(minutes(-25)),bulk=Some(true))
    set(f,rows("b-sized"),JobState.Queued,waiting=Some(minutes(-50)),total=Some(150))
    set(f,rows("b-fresh-new"),JobState.Queued,waiting=Some(minutes(-1)))
    set(f,rows("b-held"),JobState.Queued,lease=Some(minutes(20)),waiting=Some(minutes(-70)))
    rows
  }

  test("ahead under Waiting: candidates of every eligible owner before the job in its class order, sized jobs in lane 0's") { withFixture { f =>
    plantA(f)
    def ahead(owner: String): Map[String,Option[Long]] = jobs(f,waiting,owner).values.map(j => j.session.metadata.title -> j.ahead).toMap
    assertEquals(ahead("a"),Map("a-fresh" -> Some(1L),"a-bulk" -> Some(0L),"a-reclaim" -> Some(0L),"a-sized" -> Some(0L),"a-held" -> None,"a-unclassified" -> None))
    plantB(f)
    assertEquals(ahead("a"),Map("a-fresh" -> Some(3L),"a-bulk" -> Some(1L),"a-reclaim" -> Some(1L),"a-sized" -> Some(1L),"a-held" -> None,"a-unclassified" -> None))
    assertEquals(ahead("b"),Map("b-fresh-old" -> Some(0L),"b-fresh-mid" -> Some(2L),"b-bulk" -> Some(0L),"b-sized" -> Some(0L),"b-fresh-new" -> Some(4L),"b-held" -> None))
    val queue=summary(f,waiting,"a").queue.get
    assertEquals(queue.claimOrder,ActivityClaimOrder.Waiting)
    assertEquals(queue.awaitingLarge,1L); assertEquals(queue.largeAhead,Some(1L))
    // An owner whose indexing is off is not eligible: its jobs are not ahead of anyone's.
    preference(f,"b",IndexingChoice.Disable)
    assertEquals(ahead("a")("a-fresh"),Some(1L))
  }}

  test("ahead under SourceId: today's order of owner id, then source id; a lane without the permit passes permit-only jobs") { withFixture { f =>
    val a=plantA(f); val b=plantB(f)
    def candidates(rows: Map[String,Row],titles: String*): List[Row] = titles.map(rows).toList
    val aSmall=candidates(a,"a-fresh","a-bulk","a-reclaim","a-unclassified"); val aLarge=candidates(a,"a-sized")
    val bSmall=candidates(b,"b-fresh-old","b-fresh-mid","b-bulk","b-fresh-new"); val bLarge=candidates(b,"b-sized")
    def uuidOrder(x: UUID,y: UUID): Int = java.util.Arrays.compareUnsigned(bytes(x),bytes(y))
    def bytes(u: UUID): Array[Byte] = java.nio.ByteBuffer.allocate(16).putLong(u.getMostSignificantBits).putLong(u.getLeastSignificantBits).array()
    def earlier(row: Row,rows: List[Row]): Long = rows.count(o => o.owner<row.owner || (o.owner==row.owner && uuidOrder(o.session,row.session)<0)).toLong
    val all=aSmall++aLarge++bSmall++bLarge
    val small=aSmall++bSmall
    def expected(rows: List[Row],large: Boolean): Map[String,Option[Long]] = rows.map(r => r.title -> Some(earlier(r,if(large) all else small))).toMap
    val readA=jobs(f,ClaimOrderMode.SourceId,"a").values.map(j => j.session.metadata.title -> j.ahead).toMap
    val readB=jobs(f,ClaimOrderMode.SourceId,"b").values.map(j => j.session.metadata.title -> j.ahead).toMap
    assertEquals(readA,expected(aSmall,false)++expected(aLarge,true)+("a-held" -> None))
    assertEquals(readB,expected(bSmall,false)++expected(bLarge,true)+("b-held" -> None))
    assert(bSmall.forall(r => readB(r.title).exists(_>=aSmall.size.toLong)),"every candidate of the earlier owner is ahead")
  }}

  test("another owner's jobs change only the ahead counts: no other field or byte of any response, and nothing of theirs is named") { withFixture { f =>
    plantA(f)
    def responses(mode: ClaimOrderMode): (ActivityJobsResult,ActivityResult) = (activity(f,mode).jobs("a",query()),summary(f,mode,"a"))
    def counts(result: ActivityJobsResult): List[Option[Long]] = result.jobs.map(_.ahead)
    def withoutCounts(result: ActivityJobsResult): String = Wire.encode(ActivityJobsResult.codecJson,result.copy(jobs=result.jobs.map(_.copy(ahead=None)))).noSpaces
    def summaryWithoutCounts(result: ActivityResult): String = Wire.encode(ActivityResult.codecJson,result.copy(queue=result.queue.map(_.copy(largeAhead=None)))).noSpaces
    val modes=List(ClaimOrderMode.SourceId,waiting)
    val alone=modes.map(responses)
    val b=plantB(f)
    val together=modes.map(responses)
    alone.zip(together).zip(modes).foreach { case (((jobsAlone,summaryAlone),(jobsTogether,summaryTogether)),mode) =>
      assertEquals(withoutCounts(jobsTogether),withoutCounts(jobsAlone),mode.toString)
      assertEquals(summaryWithoutCounts(summaryTogether),summaryWithoutCounts(summaryAlone),mode.toString)
      val text=Wire.encode(ActivityJobsResult.codecJson,jobsTogether).noSpaces+Wire.encode(ActivityResult.codecJson,summaryTogether).noSpaces
      b.values.foreach { row => List(row.job.toString,row.session.toString,row.title).foreach(value => assert(!text.contains(value),s"$mode names $value")) }
    }
    val (waitingAlone,waitingTogether)=(alone(1),together(1))
    assertNotEquals(counts(waitingTogether._1),counts(waitingAlone._1),"the counts include the other owner's older jobs")
    assertNotEquals(waitingTogether._2.queue.get.largeAhead,waitingAlone._2.queue.get.largeAhead)
  }}

  test("per-class counts read the owner's own jobs only") { withFixture { f =>
    plantA(f); plantB(f)
    val queue=summary(f,waiting,"a").queue.get
    assertEquals(queue.fresh,ActivityClassQueue(3,2,1,1,Some(minutes(-60).toString)))
    assertEquals(queue.bulk,ActivityClassQueue(2,2,0,0,Some(minutes(-20).toString)))
    assertEquals(queue.unclassified,ActivityClassQueue(1,1,0,0,None))
    assertEquals(summary(f,ClaimOrderMode.SourceId,"a").queue.get.copy(claimOrder=ActivityClaimOrder.Waiting,largeAhead=None),queue.copy(largeAhead=None))
  }}
}
