package chronicle

import java.util.UUID
import java.util.concurrent.{CountDownLatch,TimeUnit}
import scala.collection.mutable.ListBuffer

/** T4 and (c) (claim-order DESIGN §9, §12 NEW-3; spec R5, D-b, CHECK-r3 B1): lanes paused at controlled lock points — a lane
  * stopped by ClaimOrder.Race between its candidate statement (its source locked) and its job lock, job locks and owner
  * locks held by further connections — never by timing. Every claim is checked against the per-lane oracle: the minimum of
  * the lane's order among the rows not locked at its statement (ClaimOrderFixtures.expected). */
final class ClaimOrderConcurrencyTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  /** Stops the claim at its first candidate (or at `job`) until released; `reached` once it is there. */
  private final class Pause(job: Option[UUID] = None) extends ClaimOrder.Race {
    val reached=new CountDownLatch(1); private val release=new CountDownLatch(1)
    @volatile var at: Option[UUID]=None
    def afterCandidate(candidate: UUID): Unit = if(at.isEmpty && job.forall(_==candidate)) {
      at=Some(candidate); reached.countDown(); awaited(release,"pause never released")
    }
    def awaitReached(): Unit = awaited(reached,"the claim never reached its candidate")
    def resume(): Unit = release.countDown()
  }
  /** A gate inside the candidate statement, after its snapshot and before any row lock of it: the claims of `archive` run on
    * connections whose search_path puts claim_order_gate before pg_catalog, so the statement's clock_timestamp() (in the
    * claimability of a job with a lease) is the gate's, which waits while the test holds the gate's advisory lock. Test-only
    * database objects; production code and SQL are unchanged. Built and torn down by [[withGate]]. */
  private final class StatementGate(gated: Database,holder: Database,c: Config) {
    val archive: PostgresArchive = new PostgresArchive(gated,c)
    private val held=new CountDownLatch(1); private val release=new CountDownLatch(1)
    /** Closes the gate, then runs `work` on another thread. */
    def closed[A](pool: java.util.concurrent.ExecutorService)(work: => A): java.util.concurrent.Future[A] = {
      async(pool)(holder.transaction { h => Sql.exec(h,s"SELECT pg_advisory_xact_lock(${StatementGate.key})"); held.countDown(); awaited(release,"gate never opened") })
      awaited(held,"gate never closed")
      async(pool)(work)
    }
    def open(): Unit = release.countDown()
  }
  private object StatementGate { val key=718293L }
  /** Runs `body` with a gate: the schema's drop is registered right after its DDL; the gated pool and the holder's pool are
    * each closed whatever happens (also if the other's close fails); the gate is opened before they close; the schema is
    * dropped after both. */
  private def withGate[A](c: Config,db: Database)(body: StatementGate => A): A = {
    db.transaction { x =>
      Sql.exec(x,"CREATE SCHEMA claim_order_gate")
      Sql.exec(x,s"""CREATE FUNCTION claim_order_gate.clock_timestamp() RETURNS timestamptz LANGUAGE plpgsql VOLATILE AS $$$$
        BEGIN
          IF strpos(current_query(),'ORDER BY j.waiting_since,j.session_id FOR UPDATE OF s SKIP LOCKED LIMIT 1')>0 THEN PERFORM pg_advisory_xact_lock_shared(${StatementGate.key}); END IF;
          RETURN pg_catalog.clock_timestamp();
        END $$$$""")
    }
    try scala.util.Using.resource(Database.withFactory(c,IndexProfileCatalog.current(c),new ponygirls.runtime.JdbcConnectionFactory {
      def open(url: String,properties: java.util.Properties): java.sql.Connection = {
        val options=new java.util.Properties(); options.putAll(properties); options.setProperty("options","-c search_path=claim_order_gate,pg_catalog,public")
        java.sql.DriverManager.getConnection(url,options)
      }
    })) { gated =>
      scala.util.Using.resource(other(c)) { holder =>
        val gate=new StatementGate(gated,holder,c)
        try body(gate) finally gate.open()
      }
    } finally db.transaction(x => Sql.exec(x,"DROP SCHEMA IF EXISTS claim_order_gate CASCADE"))
  }
  /** A claim of `lane` through ClaimOrder with `race` (no first supersession transaction: none of these queues has one). */
  private def paused(a: PostgresArchive,lane: ClaimLane,race: ClaimOrder.Race): ClaimOutcome = ClaimOrder.claim(a,a.knownProfiles,ClaimScope.AllOwners,300,lane,race)
  /** `lane`'s claim on another thread, which must end while the paused lane holds its locks without waiting for any lock;
    * its job is the oracle's among the rows unlocked at its statement. */
  private def alongside(db: Database,a: PostgresArchive,lane: ClaimLane,locked: Set[UUID])(using pool: java.util.concurrent.ExecutorService): Claim = {
    val wanted=expected(lane,snapshot(db),locked)
    val work=async(pool)(claim(a,lane))
    assert(endsWithoutLockWait(db,work),s"lane ${lane.index}'s claim waited for a lock held by the paused lane")
    val taken=claimed(work.get)
    assertEquals(Some(taken.jobId),wanted,s"lane ${lane.index}")
    taken
  }

  test("T4 {B1,B2,F1}: lane 0 paused on the globally oldest bulk job B1; the bulk and fresh lanes complete meanwhile with B2 and F1, then lane 0 takes B1") { database { (c,db,a) =>
    val b1=job(db,a,"a",1,true); val f1=job(db,a,"b",2,false); val b2=job(db,a,"c",3,true); val f2=job(db,a,"a",4,false)
    withPool(3) { pool =>
      given java.util.concurrent.ExecutorService = pool
      val pause=new Pause(); val first=async(pool)(paused(a,lane0,pause)); pause.awaitReached()
      assertEquals(pause.at,Some(b1))
      val locked=Set(source(db,b1))
      assertEquals(List(bulkLane,freshLane).map(alongside(db,a,_,locked).jobId),List(b2,f1))
      pause.resume()
      assertEquals(claimed(first.get).jobId,b1)
    }
    assertEquals(row(db,f2).state,"Queued")
  }}

  test("T4 {B1,F1,F2}: the bulk lane paused on B1; lane 0 takes F1 (the oldest unlocked of any class), the fresh lane F2, then the bulk lane B1") { database { (c,db,a) =>
    val b1=job(db,a,"a",1,true); val f1=job(db,a,"b",2,false); val b2=job(db,a,"c",3,true); val f2=job(db,a,"a",4,false)
    withPool(3) { pool =>
      given java.util.concurrent.ExecutorService = pool
      val pause=new Pause(); val first=async(pool)(paused(a,bulkLane,pause)); pause.awaitReached()
      assertEquals(pause.at,Some(b1))
      val locked=Set(source(db,b1))
      assertEquals(List(lane0,freshLane).map(alongside(db,a,_,locked).jobId),List(f1,f2))
      pause.resume()
      assertEquals(claimed(first.get).jobId,b1)
    }
    assertEquals(row(db,b2).state,"Queued")
  }}

  test("T4: a candidate whose job lock another connection holds is passed for the next candidate of the same step, without waiting: lane 0 the next sized job, a fresh lane the next fresh one") { database { (c,db,a) =>
    val s1=job(db,a,"a",1,false,Some(150)); val olderFresh=job(db,a,"b",0,false); val s2=job(db,a,"c",3,true,Some(170))
    val f1=job(db,a,"a",4,false); val olderBulk=job(db,a,"b",2,true); val f2=job(db,a,"c",5,false)
    val holder=other(c)
    try withPool(2) { pool =>
      given java.util.concurrent.ExecutorService = pool
      holder.transaction { h =>
        List(s1,olderFresh).foreach(id => Sql.one(h,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",id)(_ => ()).get)
        val large=alongside(db,a,lane0,Set(source(db,s1),source(db,olderFresh)))
        assertEquals((large.jobId,large.facts.map(_.step)),(s2,Some(ClaimStep.Preferred)))
        val fresh=alongside(db,a,freshLane,Set(source(db,s1),source(db,olderFresh)))
        assertEquals((fresh.jobId,fresh.facts.map(_.step)),(f1,Some(ClaimStep.Preferred)))
      }
    } finally holder.close()
    assertEquals(List.fill(4)(lane0).map(taken(a,_)),List(s1,olderFresh,olderBulk,f2))
  }}

  test("T4: a claim waiting for a later owner's target, locked by an uncommitted rebuild, holds no source lock: another connection locks the earlier owner's sources NOWAIT; after the rebuild commits the claim proceeds") { database { (c,db,a) =>
    // a: a head on its last attempt whose lease ended (its source is the claim's lease-exhausted cleanup's) and a queued job.
    val exhausted=job(db,a,"a",1,false); set(db,exhausted,"state='Running',attempts=5,fence=fence+1,lease_until=clock_timestamp()-interval '1 hour'")
    val queued=job(db,a,"a",2,false); val rebuilt=job(db,a,"c",3,false)
    set(db,rebuilt,"state='Complete'")
    val rebuild=other(c); val prober=other(c)
    try withPool(2) { pool =>
      val plan=rebuild.transaction { h => h.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ); OwnerReindex.preview(h,"c",IndexProfileCatalog.current(c),true) }
      val committed=new CountDownLatch(1); val applied=new CountDownLatch(1)
      val rebuilding=async(pool)(rebuild.transaction { h =>
        OwnerReindex(h,"c",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true,IndexProfileCatalog.current(c),true)
        applied.countDown(); awaited(committed,"the rebuild was never let commit")
      })
      awaited(applied,"the rebuild never applied")
      val claiming=async(pool)(claim(a,freshLane))
      assert(reachesLockWait(db,claiming),"the claim waits for c's target, locked by the rebuild")
      val sources=try prober.transaction(p => Sql.rows(p,"SELECT id FROM ch_sources WHERE owner='a' ORDER BY id FOR UPDATE NOWAIT")(_.getObject(1,classOf[UUID])))
        catch { case refused: Exception => fail(s"a source of owner a is locked while the claim waits for c's target: $refused") }
      assertEquals(sources.toSet,Set(exhausted,queued).map(source(db,_)))
      assert(!claiming.isDone)
      committed.countDown(); rebuilding.get
      assertEquals(claimed(claiming.get).jobId,queued)
    } finally { rebuild.close(); prober.close() }
    assertEquals(row(db,exhausted).state,"Failed")
    assertEquals((row(db,rebuilt).state,row(db,rebuilt).bulk),("Queued",Some(true)))
  }}

  test("T4 drain after release, (c): lane 0 paused on the oldest job while three lanes drain a mixed queue concurrently; after its release every job is claimed exactly once, no claim of a job is stale-overwritten, no candidate is left") { database { (c,db,a) =>
    val random=new scala.util.Random(4L)
    val jobs=(0 until 48).map(i => job(db,a,owners(i%3),random.nextInt(12),random.nextInt(3)==0,Option.when(i%9==4)(140+i)))
    val sizedJobs=jobs.filter(id => row(db,id).total.nonEmpty).toSet
    val claims=withPool(4) { pool =>
      val pause=new Pause(); val first=async(pool)(paused(a,lane0,pause)); pause.awaitReached()
      def drain(lane: ClaimLane): List[Claim] = {
        val out=ListBuffer.empty[Claim]; var more=true
        while(more) claim(a,lane) match {
          case ClaimOutcome.Claimed(value) => out+=value
          case ClaimOutcome.Idle => more=false
          case ClaimOutcome.Contended => ()
        }
        out.toList
      }
      val lanes=List(bulkLane,freshLane,freshLane2).map(lane => async(pool)(drain(lane)))
      val others=lanes.flatMap(_.get)
      assert(!others.exists(_.jobId==pause.at.get),"no lane takes the paused lane's candidate")
      pause.resume()
      (claimed(first.get)::others)++drain(lane0)
    }
    assertEquals(claims.map(_.jobId).sortBy(_.toString),jobs.toList.sortBy(_.toString),"every job claimed once")
    assert(claims.forall(value => value.facts.exists(f => f.lane==0 || !sizedJobs.contains(value.jobId))),"only lane 0 claims a sized job")
    assert(claims.forall(a.renew(_,300)),"every claim is the valid one of its job")
    assertEquals(jobs.map(id => (row(db,id).state,row(db,id).attempts,row(db,id).fence)).toSet,Set(("Running",1,1L)))
    assertEquals(eligible(snapshot(db)),Nil)
  }}

  test("T4 (B1) RetryJob race: the bulk lane's candidate retried between its statement and its job lock (now fresh and younger) is not claimed by the bulk order; the step starts again and takes the next bulk job") { database { (c,db,a) =>
    val raced=job(db,a,"a",1,true); val next=job(db,a,"b",2,true); val fresh=job(db,a,"c",3,false)
    val writer=other(c)
    try {
      var interfered=false
      // RetryJob's committed write of the job row (Jobs.retry's UPDATE): the real RetryJob holds the source lock, so it
      // commits before the candidate statement locks the source, after that statement's snapshot.
      val race=new ClaimOrder.Race { def afterCandidate(job: UUID): Unit = if(job==raced && !interfered) {
        interfered=true
        writer.transaction(w => Sql.exec(w,"UPDATE ch_jobs SET state='Queued',attempts=0,lease_until=NULL,transient_failures=0,transient_range=NULL,fence=fence+1,annotation_retry_epoch=annotation_retry_epoch+1,waiting_since=now(),bulk=false,completed_windows=0,total_windows=NULL WHERE id=?",raced))
      }}
      val wanted=expected(bulkLane,snapshot(db))
      assertEquals(wanted,Some(raced))
      val restarted=claimed(paused(a,bulkLane,race))
      assert(interfered)
      assertEquals((restarted.jobId,restarted.facts.map(_.step)),(next,Some(ClaimStep.Preferred)))
      assertEquals((row(db,raced).state,row(db,raced).bulk),("Queued",Some(false)))
      // Now the youngest fresh job: the fresh lane takes the older fresh job first.
      assertEquals(List(freshLane,freshLane).map(taken(a,_)),List(fresh,raced))
    } finally writer.close()
  }}

  test("T4 (B1) head-switch race: a real ingest commits the candidate's source's next revision after the candidate statement's snapshot and before its source lock; the obsolete head is never claimed, the claim takes the next current candidate and the next claim the new head, which kept the waiting order's age") { database { (c,db,a) =>
    // The obsolete head: a hold whose time has come (its claimability reads the clock, where the statement is gated).
    val request=Fixtures.snapshot(); val first=a.ingest("a",request)
    val obsolete=first.jobId; order(db,obsolete,1,false); set(db,obsolete,"lease_until=clock_timestamp()-interval '1 hour'")
    val next=job(db,a,"b",2,false)
    withGate(c,db) { gate => withPool(3) { pool =>
      val claiming=gate.closed(pool)(claim(gate.archive,freshLane))
      assert(reachesLockWait(db,claiming),"the candidate statement waits at its gate, after its snapshot")
      val switched=async(pool)(a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))).get(2,TimeUnit.MINUTES)
      assertEquals(switched.revision,2)
      gate.open()
      val taken=claimed(claiming.get)
      assertEquals((row(db,obsolete).state,row(db,obsolete).attempts),("Failed",0),"the obsolete head is never claimed")
      assertEquals((taken.jobId,taken.facts.map(_.step)),(next,Some(ClaimStep.Preferred)),"the source whose head moved is passed under its lock")
      assertEquals((row(db,switched.jobId).state,row(db,switched.jobId).waitingSince,row(db,switched.jobId).bulk),("Queued",Some(base.plusSeconds(1)),Some(false)))
      val head=claimed(claim(a,freshLane))
      assertEquals((head.jobId,head.revision),(switched.jobId,2))
    }}
  }}

  test("T4 (B1, CHECK-r3) hold race: the candidate claimed by another lane and returned to a hold between the statement and its job lock, age and class unchanged, is not claimed by any lane kind; each takes the next eligible job") { database { (c,db,a) =>
    val writer=other(c)
    try for(lane <- List(lane0,bulkLane,freshLane)) {
      val bulk=lane.kind==ClaimLane.Kind.Bulk; val total=Option.when(lane.kind==ClaimLane.Kind.Large)(150)
      val raced=job(db,a,"a",1,bulk,total); val next=job(db,a,"b",2,bulk,total)
      var interfered=false
      val race=new ClaimOrder.Race { def afterCandidate(job: UUID): Unit = if(job==raced && !interfered) {
        interfered=true
        writer.transaction(w => Sql.exec(w,"UPDATE ch_jobs SET state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()+interval '5 minutes',total_windows=NULL WHERE id=?",raced))
        writer.transaction(w => Sql.exec(w,s"UPDATE ch_jobs SET state='Queued',attempts=attempts-1,fence=fence+1,lease_until=clock_timestamp()+interval '1 hour',error='${Jobs.transientCode}',total_windows=${total.fold("NULL")(_.toString)} WHERE id=?",raced))
      }}
      val taken=claimed(paused(a,lane,race))
      assert(interfered)
      assertEquals(taken.jobId,next,s"lane ${lane.index}")
      assertEquals(row(db,raced).state,"Queued")
      assertEquals(expected(lane,snapshot(db)),None,"the held job stays unclaimable")
      db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET state='Complete' WHERE id IN(?,?)",raced,next))
    } finally writer.close()
  }}

  test("T4 NEW-3: the bulk lane borrowing fresh work returns to bulk work at its next claim after a bulk retry apply, ahead of older fresh jobs") { database { (c,db,a) =>
    val f1=job(db,a,"a",1,false); val f2=job(db,a,"a",2,false); val f3=job(db,a,"a",3,false)
    val failed=(0 until 3).map(i => job(db,a,"b",i,false)); failed.foreach(set(db,_,"state='Failed',attempts=5,error='model-http'"))
    val borrowed=claimed(claim(a,bulkLane))
    assertEquals((borrowed.jobId,borrowed.facts.map(_.step)),(f1,Some(ClaimStep.Borrowed)))
    assertEquals(bulkApply(db,"b"),3L)
    val returned=claimed(claim(a,bulkLane))
    assertEquals((returned.facts.map(_.step),failed.contains(returned.jobId)),(Some(ClaimStep.Preferred),true))
    assertEquals(Some(returned.jobId),failed.minByOption(id => source(db,id).toString),"one apply, one age: the lowest session_id first")
    assertEquals(taken(a,freshLane),f2)
  }}

  test("T4 NEW-3: fresh lanes borrowing bulk work return to fresh work at their next claims once fresh jobs arrive, ahead of older bulk jobs") { database { (c,db,a) =>
    val bulk=(1 to 4).map(i => job(db,a,owners(i%3),i,true))
    val borrowed=List(freshLane,freshLane2).map(lane => claimed(claim(a,lane)))
    assertEquals(borrowed.map(b => (b.jobId,b.facts.map(_.step))),bulk.take(2).map(_ -> Some(ClaimStep.Borrowed)).toList)
    val arrivals=List(a.ingest("b",Fixtures.snapshot()).jobId,a.ingest("c",Fixtures.snapshot()).jobId)
    val returned=List(freshLane,freshLane2).map(lane => claimed(claim(a,lane)))
    assertEquals(returned.map(_.facts.map(_.step)),List.fill(2)(Some(ClaimStep.Preferred)))
    assertEquals(returned.map(_.jobId).toSet,arrivals.toSet)
    assertEquals(taken(a,bulkLane),bulk(2))
  }}
}
