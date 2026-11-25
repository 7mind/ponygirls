package chronicle

import java.util.UUID

/** The waiting claim order's lanes on PostgreSQL (claim-order DESIGN §2): one claim of each lane kind, a lane borrowing the
  * other class, a held job lock passed within the step, and a candidate held by another transaction between the
  * candidate statement and the job lock (B1). Orders come from the stored `waiting_since`/`bulk` the fixture writes. */
class ClaimOrderLaneTest extends munit.FunSuite {
  private val lane0=ClaimLane.of(0,1); private val bulkLane=ClaimLane.of(1,1); private val freshLane=ClaimLane.of(2,1)
  private def database(f: (Config,Database,PostgresArchive) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val c=Fixtures.config(); val db=new Database(c,IndexProfileCatalog.current(c)); db.initialize()
    db.transaction { x =>
      Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations CASCADE")
      Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile)
      Sql.exec(x,"DELETE FROM ponygirls_indexing_preferences WHERE service='chronicle'")
    }
    try f(c,db,new PostgresArchive(db,c)) finally db.close()
  }
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
