package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.util.UUID

/** The waiting claim order's lanes on PostgreSQL (claim-order DESIGN §2): one claim of each lane kind, a lane borrowing the
  * other class, a held job lock passed within the step, and a candidate held by another transaction between the
  * candidate statement and the job lock (B1). Orders come from the stored `waiting_since`/`bulk` the fixture writes. */
class ClaimOrderLaneTest extends munit.FunSuite {
  private val lane0=ClaimLane.of(0,1); private val bulkLane=ClaimLane.of(1,1); private val freshLane=ClaimLane.of(2,1)
  private def database(f: (Config,Database,PostgresArchive) => Unit): Unit = ClaimOrderPostgres.withDatabase(ClaimOrderPostgres.config())(f)
  private def database(c: Config)(f: (Config,Database,PostgresArchive) => Unit): Unit = ClaimOrderPostgres.withDatabase(c)(f)
  /** A queued job of a new source of `owner`, waiting since minute `minute` of a fixed hour, of class `bulk`, sized when
    * `total` is given (a deferral's record). */
  private def job(db: Database,a: PostgresArchive,owner: String,minute: Int,bulk: Boolean,total: Option[Int] = None): UUID = {
    val id=a.ingest(owner,Fixtures.snapshot()).jobId
    db.transaction { c =>
      Sql.exec(c,"UPDATE ch_jobs SET waiting_since=?::timestamptz,bulk=? WHERE id=?",f"2026-11-25T10:$minute%02d:00Z",bulk,id)
      total.foreach(value => Sql.exec(c,"UPDATE ch_jobs SET total_windows=? WHERE id=?",value,id))
    }
    id
  }
  private def claim(c: Config,a: PostgresArchive,lane: ClaimLane): ClaimOutcome = a.claimInLane(Set(c.profile),ClaimScope.AllOwners,300,lane)
  private def claimed(outcome: ClaimOutcome): Claim = outcome match {
    case ClaimOutcome.Claimed(value) => value
    case other => fail(s"no claim: $other")
  }
  test("claim order: lane 0 takes the oldest sized job first, a bulk lane the oldest bulk job, a fresh lane the oldest unsized fresh job; a lane whose class is empty borrows the other one, and nothing is left for an empty queue") { database { (c,db,a) =>
    val freshOld=job(db,a,"b",1,false); val bulkOld=job(db,a,"c",2,true); val sized=job(db,a,"a",3,false,Some(150))
    val freshYoung=job(db,a,"a",4,false); val bulkYoung=job(db,a,"b",5,true)
    val large=claimed(claim(c,a,lane0))
    assertEquals((large.jobId,large.facts.map(f => (f.lane,f.step,f.preState))),(sized,Some((0,ClaimStep.Preferred,"Queued"))))
    assertEquals(claimed(claim(c,a,bulkLane)).jobId,bulkOld)
    val fresh=claimed(claim(c,a,freshLane))
    assertEquals((fresh.jobId,fresh.facts.map(_.step),fresh.facts.flatMap(_.waitingSince).map(_.toString)),(freshOld,Some(ClaimStep.Preferred),Some("2026-11-25T10:01:00Z")))
    assertEquals(claimed(claim(c,a,bulkLane)).jobId,bulkYoung)
    val borrowed=claimed(claim(c,a,bulkLane))
    assertEquals((borrowed.jobId,borrowed.facts.map(_.step)),(freshYoung,Some(ClaimStep.Borrowed)))
    assertEquals(claim(c,a,freshLane),ClaimOutcome.Idle)
    assertEquals(claim(c,a,lane0),ClaimOutcome.Idle)
  }}
  test("claim order worker: with claimOrder waiting a lane's iteration claims through ClaimOrder, logs `job claimed` with its lane and step and processes the job; lane 0 holds the large-job permit while it runs, a class lane does not take it") {
    val config=ClaimOrderPostgres.config().copy(indexing=IndexingCapacity.defaults.copy(annotationSessions=3,claimOrder=ClaimOrderSetting.Waiting))
    database(config) { (c,db,a) =>
      val bulk=job(db,a,"a",1,true); val fresh=job(db,a,"b",2,false)
      val admission=ModelAdmission.make(config.indexing).unsafeRunSync(); val log=new WorkerLog
      val permitFree=scala.collection.mutable.ListBuffer.empty[(UUID,Boolean)]
      val observed=new ForwardingArchive(a) {
        override def publishProblems(claim: Claim,rows: ProblemRows): Boolean = {
          permitFree+=claim.jobId -> admission.largeJob.use(IO.pure).unsafeRunSync()
          super.publishProblems(claim,rows)
        }
      }
      val embedder=new Embedder {
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
      }
      val worker=new Worker(observed,new ProblemPassageFixtures.Dummy,embedder,config,IndexProfileCatalog.current(config),admission,log.logger,ModelFixtures.failureBackoff,ModelFixtures.snapshots)
      assert(worker.onceInLane(lane0).unsafeRunSync())
      assert(worker.onceInLane(ClaimLane.of(2,1)).unsafeRunSync())
      assert(!worker.onceInLane(bulkLane).unsafeRunSync())
      assertEquals(permitFree.toList,List(bulk -> false,fresh -> true))
      assertEquals(log.lines.filter(_.startsWith("job claimed")).map(_.split(' ').filter(f => f.startsWith("jobId=") || f.startsWith("lane=") || f.startsWith("step=")).mkString(" ")),
        List(s"jobId=$bulk lane=0 step=Borrowed",s"jobId=$fresh lane=2 step=Preferred"))
      assertEquals(db.transaction(x => Sql.rows(x,"SELECT state FROM ch_jobs WHERE id IN(?,?)",bulk,fresh)(_.getString(1))),List("Complete","Complete"))
    }
  }
  test("claim order: lane 0 without a sized job takes the oldest job of either class; a fresh lane passes a sized job however old") { database { (c,db,a) =>
    val sized=job(db,a,"a",1,false,Some(150)); val bulk=job(db,a,"b",2,true); val fresh=job(db,a,"c",3,false)
    assertEquals(claimed(claim(c,a,freshLane)).jobId,fresh)
    assertEquals(claimed(claim(c,a,lane0)).jobId,sized)
    val any=claimed(claim(c,a,lane0))
    assertEquals((any.jobId,any.facts.map(_.step)),(bulk,Some(ClaimStep.Borrowed)))
  }}
  test("claim order: a candidate whose job lock another transaction holds is passed for the next candidate of the same step, not the other class") { database { (c,db,a) =>
    val oldest=job(db,a,"a",1,true); val next=job(db,a,"b",2,true); job(db,a,"c",0,false)
    val holder=new Database(c,IndexProfileCatalog.current(c))
    try holder.transaction { h =>
      Sql.one(h,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",oldest)(_ => ()).get
      val taken=claimed(claim(c,a,bulkLane))
      assertEquals((taken.jobId,taken.facts.map(_.step)),(next,Some(ClaimStep.Preferred)))
    } finally holder.close()
    assertEquals(claimed(claim(c,a,bulkLane)).jobId,oldest)
  }}
  test("claim order (B1): a candidate that passes its locked recheck but whose fenced claim UPDATE changes no row is not claimed: the same step starts again and takes it, not the other class") { database { (c,db,a) =>
    val wanted=job(db,a,"a",1,false); job(db,a,"b",2,true); job(db,a,"c",3,true)
    // Fixture-only: the first claim UPDATE of `wanted` is suppressed (a sequence is not rolled back with the probe's savepoint).
    db.transaction { x =>
      Sql.exec(x,"CREATE SEQUENCE claim_order_suppressed")
      Sql.exec(x,s"""CREATE FUNCTION claim_order_suppress() RETURNS trigger LANGUAGE plpgsql AS $$$$
        BEGIN IF NEW.id='$wanted' AND OLD.state='Queued' AND NEW.state='Running' AND nextval('claim_order_suppressed')=1 THEN RETURN NULL; END IF; RETURN NEW; END $$$$""")
      Sql.exec(x,"CREATE TRIGGER claim_order_suppress BEFORE UPDATE ON ch_jobs FOR EACH ROW EXECUTE FUNCTION claim_order_suppress()")
    }
    try {
      val taken=claimed(claim(c,a,freshLane))
      assertEquals((taken.jobId,taken.facts.map(_.step)),(wanted,Some(ClaimStep.Preferred)))
      assertEquals(db.transaction(x => Sql.one(x,"SELECT last_value FROM claim_order_suppressed")(_.getLong(1)).get),2L,"the first claim UPDATE was suppressed, the second took the job")
    } finally db.transaction { x =>
      Sql.exec(x,"DROP TRIGGER claim_order_suppress ON ch_jobs"); Sql.exec(x,"DROP FUNCTION claim_order_suppress()"); Sql.exec(x,"DROP SEQUENCE claim_order_suppressed")
    }
  }}
  test("claim order (B1): a candidate claimed and returned to a hold by another lane between the candidate statement and its job lock, its key unchanged, is not claimed: the same step starts again and takes the next candidate") { database { (c,db,a) =>
    val raced=job(db,a,"a",1,false); val next=job(db,a,"b",2,false)
    val other=new Database(c,IndexProfileCatalog.current(c))
    try {
      var interfered=false
      val race=new ClaimOrder.Race {
        def afterCandidate(job: UUID): Unit = if(job==raced && !interfered) {
          interfered=true
          // Another lane's claim, then its transient failure's hold: committed while this claim's candidate statement is done.
          other.transaction(o => Sql.exec(o,"UPDATE ch_jobs SET state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()+interval '5 minutes' WHERE id=?",raced))
          other.transaction(o => Sql.exec(o,"UPDATE ch_jobs SET state='Queued',attempts=attempts-1,lease_until=clock_timestamp()+interval '1 hour' WHERE id=?",raced))
        }
      }
      val taken=claimed(ClaimOrder.claim(a,Set(c.profile),ClaimScope.AllOwners,300,freshLane,race))
      assert(interfered)
      assertEquals(taken.jobId,next)
      assertEquals(db.transaction(x => Sql.one(x,"SELECT state,waiting_since::text FROM ch_jobs WHERE id=?",raced)(r => (r.getString(1),r.getString(2)))).get._1,"Queued")
    } finally other.close()
  }}
}
/** The owned PostgreSQL of scripts/test-postgres.sh (CHRONICLE_TEST_JDBC), required: these suites never skip. */
private[chronicle] object ClaimOrderPostgres extends munit.Assertions {
  def config(): Config = {
    assert(sys.env.contains("CHRONICLE_TEST_JDBC"),"PostgreSQL required: run through chronicle/scripts/test-postgres.sh (CHRONICLE_TEST_JDBC)")
    Fixtures.config()
  }
  /** `c` (from `config()`) on an initialized database with no sources, jobs or indexing preferences. */
  def withDatabase(c: Config)(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    assert(sys.env.contains("CHRONICLE_TEST_JDBC"),"PostgreSQL required: run through chronicle/scripts/test-postgres.sh (CHRONICLE_TEST_JDBC)")
    val db=new Database(c,IndexProfileCatalog.current(c)); db.initialize()
    db.transaction { x =>
      Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE")
      Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile)
      Sql.exec(x,"DELETE FROM ponygirls_indexing_preferences WHERE service='chronicle'")
    }
    try f(c,db,new PostgresArchive(db,c)) finally db.close()
  }
}
