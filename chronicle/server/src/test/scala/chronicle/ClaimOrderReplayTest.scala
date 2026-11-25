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

  /** 25 Nov STARVATION: four low-id sources appended every tick, twenty high-id bulk jobs of one apply waiting; 30 ticks of
    * four lanes, each job done within its tick. Returns the bulk jobs claimed, in claim order. */
  private def starvation(c: Config,db: Database,a: PostgresArchive): (List[UUID],List[UUID]) = {
    val sources=ingestAll(a,"a",24).sortBy(_.sessionId.toString)
    val (live,bulk)=(sources.take(4),sources.drop(4).map(_.jobId))
    fail(db,bulk); assertEquals(bulkApply(db,"a"),20L)
    var heads=live.map(r => (r.sessionId,a.headSnapshot("a",r.sessionId),1))
    val taken=mutable.ListBuffer.empty[UUID]
    for(tick <- 0 until 30) {
      heads=heads.map { (id,request,revision) =>
        val next=request.copy(requestId=UUID.randomUUID(),expectedRevision=revision); a.ingest("a",next); (id,next,revision+1)
      }
      val claims=ClaimOrderMode.of(c) match {
        case ClaimOrderMode.SourceId => (0 until 4).flatMap(lane => a.claim(a.knownProfiles,ClaimScope.AllOwners,300,if(lane==0) LargeJobs.Admitted else LargeJobs.Skipped))
        case ClaimOrderMode.Waiting(_) => List(lane0,bulkLane,freshLane,freshLane2).flatMap(lane => claim(a,lane) match { case ClaimOutcome.Claimed(value) => Some(value); case _ => None })
      }
      claims.foreach(value => assert(a.publish(value,Nil)))
      taken++=claims.map(_.jobId).filter(bulk.contains)
    }
    (bulk,taken.toList)
  }
  test("T10 (25 Nov STARVATION), flag on: steady appends of low-id sources do not hold back older high-id bulk jobs: they are served oldest first (one apply, so by session_id) and all within the run") { database { (c,db,a) =>
    val (bulk,taken)=starvation(c,db,a)
    assertEquals(taken,bulk,"every bulk job, in (waiting_since, session_id) order")
  }}
  test("T10 (25 Nov STARVATION), flag off: today's order serves the low-id appends at every claim; no bulk job is claimed in the run") { database(ClaimOrderPostgres.config()) { (c,db,a) =>
    val (bulk,taken)=starvation(c,db,a)
    assertEquals(taken,Nil)
    assertEquals(bulk.map(row(db,_).state).distinct,List("Queued"))
  }}

  test("T10 (D-c, the documented limit): two older bulk jobs alternate on the sole bulk lane, each attempt held until the other's ended, while lane 0 runs a large job and the fresh lanes take fresh work: a younger bulk job is never claimed") { database { (c,db,a) =>
    val b1=job(db,a,"a",1,true); val b2=job(db,a,"b",2,true); val b3=job(db,a,"c",3,true)
    val large=job(db,a,"a",0,false,Some(400))
    assertEquals(taken(a,lane0),large)
    var previous=Option.empty[UUID]
    val bulkClaims=(1 to 6).map { round =>
      (0 until 2).foreach(_ => a.ingest(if(round%2==0) "b" else "c",Fixtures.snapshot()))
      List(freshLane,freshLane2).foreach { lane =>
        val fresh=claimed(claim(a,lane)); assertEquals(fresh.facts.map(_.step),Some(ClaimStep.Preferred)); assert(a.publish(fresh,Nil))
      }
      val attempt=claimed(claim(a,bulkLane))
      // The attempt fails transiently after outlasting the other job's hold: it is held, the other one is due again.
      assert(a.holdTransient(attempt,Some(IndexingStage.Annotation),Deadline.now+30.seconds).isInstanceOf[TransientOutcome.Held])
      previous.foreach(id => db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET lease_until=clock_timestamp() WHERE id=? AND state='Queued'",id)))
      previous=Some(attempt.jobId)
      attempt.jobId
    }
    assertEquals(bulkClaims.toList,List(b1,b2,b1,b2,b1,b2))
    assertEquals((row(db,b3).state,row(db,b3).attempts,row(db,b3).fence),("Queued",0,0L),"the younger bulk job waits as long as the alternation lasts")
    assertEquals(row(db,large).state,"Running")
  }}
}
