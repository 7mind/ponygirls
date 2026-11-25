package chronicle

import chronicle.api.*
import java.time.Instant
import java.util.UUID
import scala.collection.mutable
import scala.concurrent.duration.*

/** T10 (claim-order DESIGN §8-§9; spec §8 T10, §3, §5.3 D-c): replays on PostgreSQL with a scripted provider and a controlled
  * clock. The clock is a tick count (a virtual minute); the scripted provider gives each job its window count, and a lane
  * busy with a job of w windows is free again after ceil(w/30) ticks. Lanes act as the worker does: a class lane defers what
  * it sizes above LargeJobs.windows (archive.defer) and claims again; a finished job publishes (archive.publish). Every claim
  * goes through the production claim and is checked against the independent model of its lane's order. */
final class ClaimOrderReplayTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  // The spec's queue: 892 sources ingested and a bulk apply, then a replay of 150 ticks.
  override val munitTimeout=5.minutes
  private def ingestAll(a: PostgresArchive,owner: String,count: Int): List[IngestReceipt] =
    withPool(8)(pool => (0 until count).map(_ => async(pool)(a.ingest(owner,Fixtures.snapshot()))).map(_.get).toList)
  private def fail(db: Database,jobs: Iterable[UUID]): Unit = db.transaction { x =>
    Sql.exec(x,s"UPDATE ch_jobs SET state='Failed',attempts=5,error='model-http' WHERE id IN(${jobs.map(id => s"'$id'").mkString(",")})"); ()
  }
  /** A live source of owner `owner`: each append adds one message. */
  private final class Live(a: PostgresArchive,owner: String) {
    private var request=messages(1,"live")
    val first: IngestReceipt = a.ingest(owner,request)
    def append(): IngestReceipt = {
      val next=messages(request.messages.size+1,"live")
      val receipt=a.ingest(owner,next.copy(requestId=UUID.randomUUID(),expectedRevision=request.messages.size,source=request.source))
      request=next.copy(source=request.source); receipt
    }
  }

  test("T10 (24 Nov shape): 3 owners; a live session of 1,013 windows (406 accepted) appended every 5 ticks; 47 bulk jobs above 100 windows (8 sized) and 845 small ones; fresh arrivals every 2 ticks; L=4, bulkLanes=1: every claim is its lane's minimum, lane 0 takes sized work oldest first and is never idle with a candidate, only lane 0 runs more than 100 windows, the live heads' ages follow D3a") { database { (c,db,a) =>
    val random=new scala.util.Random(24L)
    val sizes=mutable.Map.empty[UUID,Int]
    val live=new Live(a,"a"); var accepted=406; var liveTotal=1013
    sizes(live.first.jobId)=liveTotal-accepted
    val liveTotals=mutable.Map(live.first.jobId -> liveTotal)
    val backlog=ingestAll(a,"a",892).map(_.jobId)
    fail(db,backlog); assertEquals(bulkApply(db,"a"),892L)
    val largeJobs=random.shuffle(backlog).take(47).toSet
    backlog.foreach(id => sizes(id)=if(largeJobs.contains(id)) 101+random.nextInt(300) else 1+random.nextInt(30))
    // Eight of the large ones were sized by an earlier deferral.
    largeJobs.take(8).foreach(id => set(db,id,s"total_windows=${sizes(id)}"))
    val lanes=Vector(lane0,bulkLane,freshLane,freshLane2)
    val busy=mutable.Map.empty[ClaimLane,(Claim,Int)]
    var lane0Sized=List.empty[UUID]; var largeRuns=List.empty[(Int,Int)]; var claims=0; var appends=0; var inherited=0
    def duration(windows: Int): Int = (windows+29)/30
    for(tick <- 0 until 150) {
      if(tick%2==0) { val id=a.ingest(if(tick%4==0) "b" else "c",Fixtures.snapshot()).jobId; sizes(id)=1+random.nextInt(20) }
      if(tick%5==0 && tick>0) {
        val before=snapshot(db).rows.filter(r => r.source==live.first.sessionId && Set("Queued","Running").contains(r.state))
        val receipt=live.append(); liveTotal+=2; appends+=1
        sizes(receipt.jobId)=liveTotal-accepted; liveTotals(receipt.jobId)=liveTotal
        val head=row(db,receipt.jobId)
        before.filter(_.state=="Queued").maxByOption(_.revision) match {
          case Some(queued) => assertEquals((head.waitingSince,head.bulk),(queued.waitingSince,queued.bulk),s"tick $tick: the append inherits the queued head's age"); inherited+=1
          case None =>
            val switchedAt=db.transaction(x => Sql.one(x,"SELECT now()")(_.getObject(1,classOf[java.time.OffsetDateTime]).toInstant).get)
            assert(head.waitingSince.exists(since => before.forall(_.waitingSince.forall(since.isAfter)) && !since.isAfter(switchedAt)),s"tick $tick: D3a, a new age behind a running predecessor")
            assertEquals(head.bulk,Some(false))
        }
      }
      for((lane,(claim,until)) <- busy.toList if until<=tick) {
        assert(a.publish(claim,Nil),s"tick $tick lane ${lane.index}")
        liveTotals.get(claim.jobId).foreach(total => accepted=accepted.max(total))
        busy.remove(lane)
      }
      for(lane <- lanes if !busy.contains(lane)) {
        var looking=true
        while(looking) {
          val before=snapshot(db)
          val wanted=expected(lane,before)
          claim(a,lane) match {
            case ClaimOutcome.Claimed(taken) =>
              claims+=1
              assertEquals(Some(taken.jobId),wanted,s"tick $tick lane ${lane.index}")
              val windows=sizes(taken.jobId)
              if(lane.kind==ClaimLane.Kind.Large && before.rows.exists(r => r.job==taken.jobId && sized(r))) lane0Sized:+=taken.jobId
              if(windows>LargeJobs.windows && lane.kind!=ClaimLane.Kind.Large) assert(a.defer(taken,windows),"the class lane defers what it sized")
              else { if(windows>LargeJobs.windows) largeRuns:+=(lane.index,windows); busy(lane)=(taken,tick+duration(windows)); looking=false }
            case ClaimOutcome.Idle => assertEquals(wanted,None,s"tick $tick: lane ${lane.index} idle with a candidate"); looking=false
            case ClaimOutcome.Contended => fail("a claim without a concurrent claim was contended")
          }
        }
      }
    }
    assert(claims>=400 && appends==29 && inherited>0 && lane0Sized.size>=8 && largeRuns.nonEmpty,s"the replay exercised the shape: $claims claims, $appends appends, $inherited inherited, ${lane0Sized.size} sized, ${largeRuns.size} large runs")
    assertEquals(largeRuns.map(_._1).distinct,List(0),"only lane 0 runs more than 100 windows")
  }}

  /** 25 Nov STARVATION: four low-id sources, each appended (one more message) every tick; twenty high-id bulk jobs of one
    * apply waiting; 30 ticks; each job claimed in a tick is done within it. Flag on, lane 0 runs a sized job throughout, so only
    * the bulk lane can serve the bulk jobs; flag off, four lanes of today's claim. Returns the bulk jobs and, per tick, the
    * bulk lane's claim (flag on) or the bulk jobs claimed (flag off). */
  private def starvation(c: Config,db: Database,a: PostgresArchive): (List[UUID],List[List[UUID]]) = {
    val requests=(0 until 24).map(i => (s"starvation $i",messages(1,s"starvation $i"))).toList
    val sources=withPool(8)(pool => requests.map(request => async(pool)(request -> a.ingest("a",request._2))).map(_.get)).sortBy(_._2.sessionId.toString)
    val (live,bulk)=(sources.take(4),sources.drop(4).map(_._2.jobId))
    fail(db,bulk); assertEquals(bulkApply(db,"a"),20L)
    val waiting=ClaimOrderMode.of(c)!=ClaimOrderMode.SourceId
    val large=Option.when(waiting)(job(db,a,"b",0,false,Some(400)))
    large.foreach(id => assertEquals(taken(a,lane0),id))
    var heads=live.map((request,_) => request)
    (bulk,(0 until 30).map { tick =>
      heads=heads.map { (tag,request) =>
        val next=messages(request.messages.size+1,tag).copy(source=request.source)
        a.ingest("a",next.copy(requestId=UUID.randomUUID(),expectedRevision=request.messages.size)); (tag,next)
      }
      val claims=if(!waiting) (0 until 4).flatMap(lane => a.claim(a.knownProfiles,ClaimScope.AllOwners,300,if(lane==0) LargeJobs.Admitted else LargeJobs.Skipped)).toList
        else List(bulkLane,freshLane,freshLane2).flatMap(lane => claim(a,lane) match { case ClaimOutcome.Claimed(value) => Some(value); case _ => None })
      claims.foreach(value => assert(a.publish(value,Nil)))
      if(waiting) claims.filter(_.facts.exists(_.lane==bulkLane.index)).map(_.jobId) else claims.map(_.jobId).filter(bulk.contains)
    }.toList)
  }
  test("T10 (25 Nov STARVATION), flag on: with lane 0 busy, the bulk lane serves the waiting high-id bulk jobs at its next claims, oldest first (one apply, so by session_id), while low-id sources are appended every tick") { database { (c,db,a) =>
    val (bulk,perTick)=starvation(c,db,a)
    assertEquals(perTick.take(20),bulk.map(List(_)),"the bulk lane's claim of each tick: the next bulk job")
    assert(perTick.drop(20).forall(_.size==1) && perTick.drop(20).flatten.forall(id => !bulk.contains(id)),"then it borrows fresh work")
  }}
  test("T10 (25 Nov STARVATION), flag off: today's order serves the low-id appends at every claim; no bulk job is claimed in the run") { database(ClaimOrderPostgres.config()) { (c,db,a) =>
    val (bulk,perTick)=starvation(c,db,a)
    assertEquals(perTick.flatten,Nil)
    assertEquals(bulk.map(row(db,_).state).distinct,List("Queued"))
  }}

  test("T10 (D-c, the documented limit): two older bulk jobs alternate on the sole bulk lane — each attempt commits progress, then fails transiently and is held until the other's attempt ended — past the consecutive-failure limit, while lane 0 runs a large job and the fresh lanes take fresh work: a younger bulk job is never claimed") { database { (c,db,a) =>
    val b1=job(db,a,"a",1,true); val b2=job(db,a,"b",2,true); val b3=job(db,a,"c",3,true)
    val large=job(db,a,"a",0,false,Some(400))
    assertEquals(taken(a,lane0),large)
    val rounds=2*(Jobs.transientBackoff.limit+2)
    var previous=Option.empty[UUID]
    val bulkClaims=(1 to rounds).map { round =>
      (0 until 2).foreach(_ => a.ingest(if(round%2==0) "b" else "c",Fixtures.snapshot()))
      List(freshLane,freshLane2).foreach { lane =>
        val fresh=claimed(claim(a,lane)); assertEquals(fresh.facts.map(_.step),Some(ClaimStep.Preferred)); assert(a.publish(fresh,Nil))
      }
      val attempt=claimed(claim(a,bulkLane))
      // The attempt succeeds on its previously failed range (a committed checkpoint: progress), then fails on another one
      // transiently: it is held, its streak restarted; the other job's hold has ended meanwhile.
      a.checkpoint(attempt,IndexCheckpoints.key(attempt,IndexingStage.Annotation,round,0,ProblemPassages.identity,io.circe.Json.fromString(s"window $round")),io.circe.Json.fromString("accepted"))
      assertEquals(a.holdTransient(attempt,Some(IndexingStage.Annotation),Deadline.now+30.seconds) match { case TransientOutcome.Held(consecutive,_) => consecutive; case other => fail(s"not held: $other") },1)
      previous.foreach(id => db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET lease_until=clock_timestamp() WHERE id=? AND state='Queued'",id)))
      previous=Some(attempt.jobId)
      attempt.jobId
    }
    assertEquals(bulkClaims.toList,List.fill(rounds/2)(List(b1,b2)).flatten)
    assertEquals(List(b1,b2).map(id => (row(db,id).state,row(db,id).attempts)),List.fill(2)(("Queued",0)),s"each held ${rounds/2} times, more than the limit of ${Jobs.transientBackoff.limit} consecutive failures")
    assertEquals((row(db,b3).state,row(db,b3).attempts,row(db,b3).fence),("Queued",0,0L),"the younger bulk job waits as long as the alternation lasts")
    assertEquals(row(db,large).state,"Running")
  }}
}
