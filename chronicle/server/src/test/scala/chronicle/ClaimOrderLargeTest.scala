package chronicle

import cats.effect.{Deferred,IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** T5 and T11 (claim-order DESIGN §2 "EXPIRED-LEASE RUNNING", §9; spec R3, D-d; U2 gate r1): large jobs under the waiting
  * order, through the worker and the synthetic model provider. Sizes are real window counts of the sources (64 short
  * messages a window); stored ages and expired leases are fixture values (timing rule). */
final class ClaimOrderLargeTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  // Sources of up to 9,600 messages indexed through the worker, and queues of 702 sources.
  override val munitTimeout=5.minutes
  private val large=LargeJobs.windows+1
  private def deferrals(log: WorkerLog): List[String] = log.lines.filter(_.startsWith("large job deferred"))
  private def claimLine(log: WorkerLog,job: UUID): List[String] = log.lines.filter(_.startsWith(s"job claimed jobId=$job"))
  /** Polls `value` until `done` (state the worker's fibers reach; the bound only ends a hung run). */
  private def poll[A](value: IO[A])(done: A => Boolean): IO[A] = (IO.sleep(20.millis) *> value).iterateUntil(done).timeout(2.minutes)
  private def admission(c: Config): ModelAdmission = ModelAdmission.make(c.indexing).unsafeRunSync()

  test("T5 (D-d): lane 0 takes a younger sized job before an older unsized large one (the documented limit); once a class lane has sized the older one, it precedes every younger sized job, its age kept") { database { (c,db,a) =>
    val older=a.ingest("a",windows(large,"older")).jobId; order(db,older,1,false)
    val younger=job(db,a,"b",5,false,Some(150)); val youngest=job(db,a,"c",6,true,Some(150))
    assertEquals(taken(a,lane0),younger)
    val log=new WorkerLog
    assert(worker(a,c,admission(c),log).onceInLane(freshLane).unsafeRunSync())
    assertEquals(deferrals(log).map(_.split(' ').take(6).mkString(" ")),List(s"large job deferred jobId=$older totalWindows=$large indexedWindows=$large"))
    assertEquals(row(db,older),JobRow("Queued",0,2L,Some(base.plusSeconds(1)),Some(false),Some(large),0L))
    val next=claimed(claim(a,lane0))
    assertEquals((next.jobId,next.facts.map(_.step)),(older,Some(ClaimStep.Preferred)))
    assertEquals(taken(a,lane0),youngest)
  }}

  test("T5: a Running incremental job whose lease ended, total 113 windows of which it indexes 10 (the incident's 1,013 and 10 scaled down), is reclaimed by a class lane and runs there without a deferral; today's lanes without the permit pass it") { database { (c,db,a) =>
    val request=windows(103,"live")
    val first=a.ingest("a",request)
    val log=new WorkerLog
    assert(worker(a,c,admission(c),log).onceInLane(lane0).unsafeRunSync())
    assertEquals(a.session("a",first.sessionId).indexedRevision,Some(1),"the parent generation is published")
    val second=a.ingest("a",windows(113,"live").copy(requestId=UUID.randomUUID(),expectedRevision=1,source=request.source))
    assertEquals(second.sessionId,first.sessionId)
    set(db,second.jobId,leaseEnded+",total_windows=113")
    assertEquals(a.claim(a.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Skipped),None,"today's claim without the permit passes a job of 113 windows")
    assert(worker(a,c,admission(c),log).onceInLane(freshLane).unsafeRunSync())
    assertEquals(deferrals(log),Nil)
    assertEquals(claimLine(log,second.jobId).map(_.split(' ').filter(f => f.startsWith("lane=") || f.startsWith("reclaimed=")).mkString(" ")),List("lane=2 reclaimed=true"))
    assert(log.lines.exists(line => line.startsWith(s"publication started jobId=${second.jobId}") && line.contains("totalWindows=113") && line.contains("publication=incremental")),log.lines.filter(_.startsWith("publication")).mkString("\n"))
    assertEquals(row(db,second.jobId).state,"Complete")
    assertEquals(a.session("a",second.sessionId).indexedRevision,Some(2))
  }}

  /** The admission a worker gets, recording in `events` when the large-job permit of `largeJobOwned` is acquired and released
    * (by the real semaphore's Resource) and, through the archive, each claim of lane 0. */
  private final class ObservedAdmission(real: ModelAdmission,events: ConcurrentLinkedQueue[String]) extends ModelAdmission {
    def annotationSession: Resource[IO,Unit] = real.annotationSession
    def largeJob: Resource[IO,Boolean] = real.largeJob.evalTap(admitted => IO(events.add(s"try $admitted")).void)
    def largeJobOwned: Resource[IO,Unit] =
      Resource.make(IO.unit)(_ => IO(events.add("released")).void).flatMap(_ => real.largeJobOwned).flatMap(_ => Resource.eval(IO(events.add("acquired")).void))
    def request(purpose: ModelWorkload): Resource[IO,Unit] = real.request(purpose)
  }
  /** The permit's history of one run, cancelled at "cancel": one acquisition before lane 0's first claim, held without a release
    * across at least `claims` claims of lane 0, released once, after the cancellation; no other lane tries it. */
  private def heldThroughout(events: List[String],claims: Int): Unit = {
    val permit=events.filter(event => event=="acquired" || event=="released" || event.startsWith("try"))
    assertEquals(permit,List("acquired","released"),s"one uninterrupted hold of the permit: $events")
    val (before,after)=events.span(_!="cancel")
    assert(before.indexOf("acquired")<before.indexOf("claim0") && !before.contains("released"),s"acquired before lane 0's first claim, held until the cancellation: $events")
    assert(before.count(_=="claim0")>=claims,s"lane 0 claimed at least $claims times under the one hold: $events")
    assertEquals(after.count(_=="released"),1,s"released by the cancellation: $events")
  }

  test("T5 worker run: only lane 0 ever runs a job of more than 100 windows; lane 0 acquires the large-job permit once and holds it across its claims until the run is cancelled; cancelled mid-job the job keeps its lease, is reclaimed after it ends, and lane 0 of the restarted worker, again holding the permit throughout, runs it to completion") {
    val config=waiting(ClaimOrderPostgres.config(),lanes=3)
    database(config) { (c,db,a) =>
      val first=job(db,a,"a",0,false,Some(150))
      val big=a.ingest("b",windows(large,"big")).jobId; order(db,big,1,false)
      val small=List(job(db,a,"c",2,false),job(db,a,"a",3,true))
      val windowsRun=new ConcurrentLinkedQueue[(UUID,Int,Int)]() // job, lane, total of every progress report
      val deferred=new ConcurrentLinkedQueue[(UUID,Int)]()
      def archiveOf(events: ConcurrentLinkedQueue[String],published: Ref[IO,Set[UUID]]): SessionArchive = new ForwardingArchive(a) {
        override def claimInLane(profiles: Set[String],scope: ClaimScope,lease: Int,lane: ClaimLane): ClaimOutcome = {
          if(lane.index==0) events.add("claim0")
          super.claimInLane(profiles,scope,lease,lane)
        }
        override def progress(claim: Claim,done: Int,total: Int): Boolean = { windowsRun.add((claim.jobId,claim.facts.fold(-1)(_.lane),total)); super.progress(claim,done,total) }
        override def defer(claim: Claim,total: Int): Boolean = { deferred.add((claim.jobId,claim.facts.fold(-1)(_.lane))); super.defer(claim,total) }
        override def publishProblems(claim: Claim,rows: ProblemRows): Boolean = { val result=super.publishProblems(claim,rows); published.update(_+claim.jobId).unsafeRunSync(); result }
      }
      /** Runs the worker under `observe` (its fiber cancelled when `observe` ends, also on failure), then marks the cancellation. */
      var events=new ConcurrentLinkedQueue[String]()
      def claims(): Int = events.asScala.count(_=="claim0")
      def run(model: ProblemPassageAnnotator)(observe: Ref[IO,Set[UUID]] => IO[Unit]): List[String] = {
        events=new ConcurrentLinkedQueue[String]()
        (for {
          published <- Ref.of[IO,Set[UUID]](Set.empty)
          observed=new ObservedAdmission(admission(c),events)
          _ <- worker(archiveOf(events,published),c,observed,new WorkerLog,model).run.background.use(_ => observe(published) *> IO(events.add("cancel")).void)
        } yield ()).unsafeRunSync()
        events.asScala.toList
      }
      // Run 1: the model provider stops in the big job's window 50; the run is cancelled there.
      val blocked=Deferred.unsafe[IO,Unit]
      val one=run(new ScriptedAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
          if(window.sourceJson.noSpaces.contains(s"big message ${50*ProblemPassages.maximumWindowFragments}\"")) blocked.complete(()) *> IO.never else annotator.annotate(owner,window,previous)
      })(published => blocked.get.timeout(2.minutes) *> poll(published.get)(_==(first::small).toSet).void)
      heldThroughout(one,2)
      val held=row(db,big)
      assertEquals((held.state,held.total),("Running",Some(large)),"cancelled mid-job, the job keeps its claim and lease")
      assert(db.transaction(x => Sql.one(x,"SELECT lease_until>clock_timestamp() FROM ch_jobs WHERE id=?",big)(_.getBoolean(1)).get))
      // The lease ends (fixture clock); the restarted worker reclaims the job.
      set(db,big,"lease_until=clock_timestamp()-interval '1 second'")
      val bigCalls=new java.util.concurrent.atomic.AtomicInteger(0)
      val counting=new ScriptedAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
          IO(if(window.sourceJson.noSpaces.contains("big message")) bigCalls.incrementAndGet()) *> annotator.annotate(owner,window,previous)
      }
      // Run 2 is cancelled after lane 0's next claim following the big job's completion.
      val two=run(counting)(published => poll(published.get)(_.contains(big)) *> IO(claims()).flatMap(done => poll(IO(claims()))(_>done)).void)
      heldThroughout(two,2)
      assertEquals(row(db,big).state,"Complete")
      val bigRuns=windowsRun.asScala.toList.filter((_,_,total) => total>LargeJobs.windows)
      assert(bigRuns.nonEmpty && bigRuns.forall((job,lane,_) => job==big && lane==0),s"only lane 0 runs more than ${LargeJobs.windows} windows: ${bigRuns.map(_._2).distinct}")
      assert(deferred.asScala.forall((job,lane) => job==big && lane!=0),s"only class lanes defer: ${deferred.asScala.toList}")
      assertEquals(bigCalls.get,large-50,"the reclaim keeps the 50 windows accepted before the cancellation and annotates the rest")
    }
  }

  /** T11: two head jobs Running with ended leases (a restart) behind 700 queued heads of lower source ids: one small, one of
    * 150 windows without a parent cut; younger sized jobs wait for lane 0. Returns the two, the 700 and the younger sized. */
  private def restartQueue(db: Database,a: PostgresArchive): (UUID,UUID,List[UUID],List[UUID]) = {
    val receipts=withPool(8)(pool => (0 until 702).map(_ => async(pool)(a.ingest("a",Fixtures.snapshot()))).map(_.get))
    val sorted=receipts.sortBy(_.sessionId.toString)
    val lower=sorted.take(700); val (small,large)=(sorted(700),sorted(701))
    // The large source's head is a revision of 150 windows (its first job never ran: no published parent).
    val big=a.ingest("a",windows(150,"restart").copy(source=a.headSnapshot("a",large.sessionId).source,expectedRevision=1)).jobId
    db.transaction { x =>
      Sql.exec(x,s"UPDATE ch_jobs SET waiting_since=?::timestamptz,bulk=true WHERE id IN(${lower.map(r => s"'${r.jobId}'").mkString(",")})",at(100))
      ()
    }
    order(db,small.jobId,10,true); order(db,big,11,true)
    set(db,small.jobId,leaseEnded+",total_windows=1"); set(db,big,leaseEnded+",total_windows=150")
    val younger=List(job(db,a,"b",200,false,Some(150)),job(db,a,"c",201,true,Some(170)))
    (small.jobId,big,lower.map(_.jobId).toList,younger)
  }

  test("T11 (25 Nov restart), flag on: the small lease-ended head is taken at the bulk lane's next claim; the 150-window one is deferred by a class lane (lane 0 held back until the deferral commits), then taken by lane 0 before younger sized jobs; its age never changes") { database { (c,db,a) =>
    val (small,big,lower,younger)=restartQueue(db,a)
    val age=row(db,big).waitingSince
    val first=claimed(claim(a,bulkLane))
    assertEquals((first.jobId,first.facts.map(f => (f.step,f.reclaimed))),(small,Some((ClaimStep.Preferred,true))))
    val log=new WorkerLog
    assert(worker(a,c,admission(c),log).onceInLane(bulkLane).unsafeRunSync())
    assertEquals(deferrals(log).map(_.split(' ').take(6).mkString(" ")),List(s"large job deferred jobId=$big totalWindows=150 indexedWindows=150"))
    assertEquals(claimLine(log,big).map(_.split(' ').filter(_.startsWith("reclaimed=")).mkString),List("reclaimed=true"))
    assertEquals((row(db,big).state,row(db,big).total,row(db,big).attempts,row(db,big).waitingSince),("Queued",Some(150),1,age))
    assert(worker(a,c,admission(c),log).onceInLane(lane0).unsafeRunSync())
    assertEquals((row(db,big).state,row(db,big).waitingSince),("Complete",age))
    assertEquals(claimLine(log,big).map(_.split(' ').filter(f => f.startsWith("lane=") || f.startsWith("step=")).mkString(" ")),List("lane=1 step=Preferred","lane=0 step=Preferred"))
    assertEquals(younger.map(row(db,_).state),List("Queued","Queued"))
    assertEquals(taken(a,lane0),younger.head)
    assertEquals(lower.map(row(db,_).state).distinct,List("Queued"))
  }}

  test("T11 (25 Nov restart), flag off: today's claims take the 700 lower-id heads before either lease-ended head, with or without the permit") { database(ClaimOrderPostgres.config()) { (c,db,a) =>
    val (small,big,lower,_)=restartQueue(db,a)
    val claims=(0 until 700).map(i => a.claim(a.knownProfiles,ClaimScope.AllOwners,300,if(i%4==0) LargeJobs.Admitted else LargeJobs.Skipped).get.jobId)
    assertEquals(claims.toSet,lower.toSet)
    assertEquals(a.claim(a.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Skipped).map(_.jobId),Some(small))
    assertEquals(a.claim(a.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Skipped).map(_.jobId),None,"without the permit the 150-window one is passed")
    assertEquals(a.claim(a.knownProfiles,ClaimScope.AllOwners,300,LargeJobs.Admitted).map(_.jobId),Some(big))
  }}
}
