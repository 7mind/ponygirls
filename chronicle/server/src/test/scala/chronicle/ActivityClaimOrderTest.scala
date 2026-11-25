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
  /** Activity of a deployment with `lanes` worker lanes (the default four unless a case needs one). */
  private def activity(f: Fixture,mode: ClaimOrderMode,lanes: Int=4): PostgresActivity = new PostgresActivity(f.db,Clock.fixed(now,ZoneOffset.UTC),ActivityClaimOrderView(mode,lanes))
  private val waiting=ClaimOrderMode.Waiting(1)
  private def query(scope: ActivityJobScope=ActivityJobScope.All): ActivityJobsQuery = ActivityJobsQuery(None,scope,"",ActivityJobSort.JobId,SortDirection.Asc,None,100)
  private def jobs(f: Fixture,mode: ClaimOrderMode,owner: String,lanes: Int=4): Map[UUID,ActivityJob] = activity(f,mode,lanes).jobs(owner,query()).jobs.map(j => j.job.id -> j).toMap
  private def summary(f: Fixture,mode: ClaimOrderMode,owner: String,lanes: Int=4): ActivityResult =
    activity(f,mode,lanes).summary(UserInfo(owner,owner,List(Scope.Read)),ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,100))

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
      // Under today's order with several lanes only a job the large-job permit is needed for has a single rank.
      val ranked=if(mode==ClaimOrderMode.SourceId) List(sized) else List(queued,sized,expired,invalidated)
      ranked.foreach(row => assert(read(row.job).ahead.nonEmpty,row.title))
      List(queued,expired,invalidated).filterNot(ranked.contains).foreach(row => assertEquals(read(row.job).ahead,None,row.title))
    }
    // The older revision's lease ends: still not current, no reason; the claim's first phase supersedes it before it
    // selects, so its head is no longer held: Queued.
    set(f,blocked,JobState.Running,lease=Some(minutes(-1)),attempts=1,waiting=Some(minutes(-3)))
    val after=jobs(f,ClaimOrderMode.SourceId,"a")
    assertEquals(after(blocked.job).waiting,None)
    assertEquals(after(blockedHead.job).waiting,Some(ActivityJobWaiting.Queued()))
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

  private def uuidOrder(x: UUID,y: UUID): Int = java.util.Arrays.compareUnsigned(bytes(x),bytes(y))
  private def bytes(u: UUID): Array[Byte] = java.nio.ByteBuffer.allocate(16).putLong(u.getMostSignificantBits).putLong(u.getLeastSignificantBits).array()
  /** The advertised order: every job of `owners` with a rank, by rank. */
  private def advertised(f: Fixture,mode: ClaimOrderMode,lanes: Int,owners: String*): List[(UUID,Long)] =
    owners.toList.flatMap(owner => jobs(f,mode,owner,lanes).values.flatMap(j => j.ahead.map(j.job.id -> _))).sortBy(_._2)

  test("ahead under SourceId: today's order (owner id, then source id) over every candidate with one lane; with more, only for jobs the permit is needed for") { withFixture { f =>
    val a=plantA(f); val b=plantB(f)
    val candidates=List("a-fresh","a-bulk","a-reclaim","a-unclassified","a-sized").map(a)++List("b-fresh-old","b-fresh-mid","b-bulk","b-fresh-new","b-sized").map(b)
    def earlier(row: Row): Long = candidates.count(o => o.owner<row.owner || (o.owner==row.owner && uuidOrder(o.session,row.session)<0)).toLong
    def read(lanes: Int): Map[String,Option[Long]] = List("a","b").flatMap(owner => jobs(f,ClaimOrderMode.SourceId,owner,lanes).values.map(j => j.session.metadata.title -> j.ahead)).toMap
    val held=Map("a-held" -> None,"b-held" -> None)
    assertEquals(read(1),candidates.map(r => r.title -> Some(earlier(r))).toMap++held)
    // b's small jobs come after a's sized one in owner order: with one lane (the permit at every claim) it is ahead of them.
    assert(List("b-fresh-old","b-fresh-mid","b-bulk","b-fresh-new").forall(t => read(1)(t).exists(_>=earlier(a("a-sized"))+1)))
    val permitOnly=Set("a-sized","b-sized")
    assertEquals(read(4),candidates.map(r => r.title -> Option.when(permitOnly(r.title))(earlier(r))).toMap++held)
  }}

  test("the advertised order is the claim's: with one lane, successive real claims take the jobs in rank order across owners") { withFixture { f =>
    plantA(f); plantB(f)
    val order=advertised(f,ClaimOrderMode.SourceId,1,"a","b")
    assertEquals(order.map(_._2),order.indices.map(_.toLong).toList,"ranks are 0..n-1 without gaps across owners")
    val claimed=order.map(_ => f.archive.claim(f.archive.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Admitted).map(_.jobId))
    assertEquals(claimed,order.map(r => Some(r._1)))
    assertEquals(f.archive.claim(f.archive.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Admitted),None,"no candidate was left unranked")
  }}

  /** The candidate statement of a waiting-order step as U2's selection runs it (ClaimOrder.candidateSql at b9c63e0e, which
    * this branch does not contain), without its locks and limit: eligible pairs with their indexing epochs, the step,
    * Jobs.claimable and the older-Running anti-check, in (waiting_since, session_id) order. At integration it is replaced
    * by ClaimOrder.candidateSql itself. */
  private def stepCandidates(f: Fixture,step: String): List[UUID] = f.db.transaction { c =>
    val pairs=List("a","b","c").flatMap { owner =>
      val eligibility=ChronicleIndexing.read(c,f.db.indexingDefaultEnabled,owner)
      Option.when(eligibility.enabled)((owner,OwnerTargets.read(c,owner,false).profile,eligibility.epoch))
    }
    val values=pairs.map(_ => "(?::text,?::text,?::bigint)").mkString(",")
    Sql.rows(c,s"""SELECT j.id FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id AND j.revision=s.revision AND NOT s.tombstone
      JOIN (VALUES $values) e(owner,profile,indexing_epoch) ON e.owner=s.owner AND e.profile=j.profile
      WHERE j.state IN('Queued','Running') AND ($step) AND ${Jobs.claimable("j","e.indexing_epoch")}
        AND NOT EXISTS(SELECT 1 FROM ch_jobs o WHERE o.session_id=j.session_id AND o.profile=j.profile AND o.state='Running' AND o.revision<j.revision OFFSET 0)
      ORDER BY j.waiting_since,j.session_id""",pairs.flatMap((o,p,e) => List[Sql.Param](o,p,e))*)(_.getObject(1,classOf[UUID]))
  }

  test("the advertised order is the claim's under Waiting: each class and the sized jobs in the order of the lane step that takes them") { withFixture { f =>
    plantA(f); plantB(f)
    val unsized=s"NOT ${Jobs.sized("j")}"
    val groups=List("sized" -> Jobs.sized("j"),"bulk" -> s"j.bulk=true AND $unsized","fresh" -> s"j.bulk=false AND $unsized")
    val read=List("a","b").flatMap(owner => jobs(f,waiting,owner).values).filter(_.ahead.nonEmpty)
    def group(j: ActivityJob): String = if(j.job.state==JobState.Queued && j.job.totalWindows.nonEmpty) "sized" else if(j.bulk.contains(true)) "bulk" else "fresh"
    groups.foreach { (name,step) =>
      val expected=stepCandidates(f,step)
      assert(expected.nonEmpty,name)
      assertEquals(read.filter(j => group(j)==name).sortBy(_.ahead.get).map(_.job.id),expected,name)
      assertEquals(read.filter(j => group(j)==name).map(_.ahead.get).sorted,expected.indices.map(_.toLong).toList,name)
    }
  }}

  test("candidates follow the claim's predicates: an older revision whose lease ended does not hold its head (the claim supersedes it first); a Running head without a lease is never a candidate") { withFixture { f =>
    val freed=source(f,"a","freed"); val unleased=source(f,"a","unleased"); val held=source(f,"a","held-by-older")
    List(freed,held).foreach(row => set(f,row,JobState.Running,lease=Some(Instant.now().plusSeconds(3600)),attempts=1,waiting=Some(minutes(-30))))
    val freedHead=revise(f,freed); val heldHead=revise(f,held)
    set(f,freed,JobState.Running,lease=Some(minutes(-5)),attempts=1,waiting=Some(minutes(-30)))
    set(f,freedHead,JobState.Queued,waiting=Some(minutes(-20))); set(f,heldHead,JobState.Queued,waiting=Some(minutes(-25)))
    set(f,unleased,JobState.Running,lease=None,attempts=1,waiting=Some(minutes(-40)))
    List((ClaimOrderMode.SourceId,1),(waiting,4)).foreach { (mode,lanes) =>
      val read=jobs(f,mode,"a",lanes)
      assertEquals((read(freedHead.job).waiting,read(freedHead.job).ahead),(Some(ActivityJobWaiting.Queued()),Some(0L)),mode.toString)
      assertEquals((read(heldHead.job).waiting,read(heldHead.job).ahead),(Some(ActivityJobWaiting.BlockedByOlderRevision(1)),None),mode.toString)
      assertEquals((read(unleased.job).waiting,read(unleased.job).ahead,read(unleased.job).leaseActive),(Some(ActivityJobWaiting.RunningWithoutLease()),None,false),mode.toString)
      val counts=summary(f,mode,"a",lanes).queue.get.fresh
      assertEquals((counts.queued,counts.claimable,counts.awaitingReclaim),(3L,1L,0L),mode.toString)
    }
    assertEquals(f.archive.claim(f.archive.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Admitted).map(_.jobId),Some(freedHead.job),"the next real claim takes the advertised candidate")
    assertEquals(f.archive.claim(f.archive.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Admitted),None,"neither the held head nor the unleased Running job is taken")
  }}

  test("the Class and Why-not-running orders are deterministic and page by cursor: reasons in their precedence, then none; bulk, fresh, then unclassified") { withFixture { f =>
    plantA(f); plantB(f)
    List(ActivityJobSort.WaitingReason,ActivityJobSort.JobClass).foreach { sort => List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
      val q=query().copy(sort=sort,direction=direction)
      val whole=activity(f,waiting).jobs("a",q).jobs
      val paged=Iterator.unfold(Option(Option.empty[String])) { cursor => cursor.map { at =>
        val page=activity(f,waiting).jobs("a",q.copy(cursor=at,limit=1)); (page.jobs,page.nextCursor.map(Some(_)))
      }}.flatten.toList
      assertEquals(paged.map(_.job.id),whole.map(_.job.id),s"$sort $direction")
      def key(j: ActivityJob): Option[Int] = sort match {
        case ActivityJobSort.JobClass => j.bulk.map(b => if(b) 0 else 1)
        case _ => j.waiting.map(w => ActivityQueueSql.reasonOrder.indexOf(w.getClass.getSimpleName)+1)
      }
      val keyed=whole.map(key)
      val (present,missing)=(keyed.takeWhile(_.nonEmpty).flatten,keyed.dropWhile(_.nonEmpty))
      assert(missing.forall(_.isEmpty),s"$sort $direction: no key last")
      assertEquals(present,if(direction==SortDirection.Asc) present.sorted else present.sorted.reverse,s"$sort $direction")
      assert(present.distinct.size>1,s"$sort $direction orders distinct keys")
    }}
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
