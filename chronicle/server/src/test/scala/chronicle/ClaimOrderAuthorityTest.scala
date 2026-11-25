package chronicle

import io.circe.Json
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}
import java.util.UUID
import java.util.concurrent.{CountDownLatch,TimeUnit}

/** T6 (claim-order DESIGN §9; spec R6, D-g): the waiting order keeps the claim's authority. A reclaimed fence is dead; a
  * same-profile rebuild or an indexing-preference change that starts while a claim holds its owners' pairs waits for the
  * claim, so no job is claimed under a stale epoch; a lane whose candidate another lane claimed since its statement never
  * overwrites that claim. */
final class ClaimOrderAuthorityTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  /** Stops a claim at its candidate until released. */
  private final class Pause extends ClaimOrder.Race {
    val reached=new CountDownLatch(1); val release=new CountDownLatch(1)
    def afterCandidate(job: UUID): Unit = if(reached.getCount>0) { reached.countDown(); awaited(release,"pause never released") }
  }
  private def target(db: Database,owner: String): Long = db.transaction(c => Sql.one(c,"SELECT epoch FROM ch_owner_targets WHERE owner=?",owner)(_.getLong(1)).get)
  private def indexingEpoch(db: Database,owner: String): Long = db.transaction(c => ChronicleIndexing.read(c,true,owner).epoch)

  test("T6: a claim whose lease ended and that another lane reclaimed can no longer checkpoint, renew or publish; the reclaiming claim can") { database { (c,db,a) =>
    val id=job(db,a,"a",1,false)
    val old=claimed(claim(a,freshLane))
    val key=IndexCheckpoints.key(old,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromString("exact input"))
    val value=Json.obj("accepted"->Json.fromString("synthetic"))
    a.checkpoint(old,key,value)
    set(db,id,"lease_until=clock_timestamp()-interval '1 second'")
    val next=claimed(claim(a,bulkLane))
    assertEquals((next.jobId,next.facts.map(f => (f.step,f.reclaimed))),(id,Some((ClaimStep.Borrowed,true))))
    assert(next.fence>old.fence)
    assertEquals(intercept[DomainError](a.checkpoint(old,key)).code,"stale-claim")
    assertEquals(intercept[DomainError](a.checkpoint(old,key,value)).code,"stale-claim")
    assert(!a.renew(old,300)); assert(!a.publish(old,Nil))
    assertEquals(a.checkpoint(next,IndexCheckpoints.key(next,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromString("exact input"))),Some(value))
    assert(a.renew(next,300)); assert(a.publish(next,Nil))
    assertEquals(row(db,id).state,"Complete")
  }}

  test("T6 (D-g): a same-profile rebuild of the candidate's owner, begun while the claim holds its pairs, waits for the claim and then finds its preview stale; the claim committed under the then current target epoch, and the next rebuild fences it: no claim of a stale epoch is ever valid") { database { (c,db,a) =>
    val id=job(db,a,"b",1,false); job(db,a,"a",2,false)
    val before=target(db,"b")
    val rebuild=other(c)
    try withPool(2) { pool =>
      val pause=new Pause
      val claiming=async(pool)(ClaimOrder.claim(a,a.knownProfiles,ClaimScope.AllOwners,300,freshLane,pause))
      awaited(pause.reached,"the claim never reached its candidate")
      val plan=rebuild.transaction { h => h.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ); OwnerReindex.preview(h,"b",IndexProfileCatalog.current(c),true) }
      val rebuilding=async(pool)(rebuild.transaction(h => OwnerReindex(h,"b",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true,IndexProfileCatalog.current(c),true)))
      assert(reachesLockWait(db,rebuilding),"the rebuild waits for the claim's shared lock on b's target")
      assertEquals(target(db,"b"),before)
      pause.release.countDown()
      val taken=claimed(claiming.get)
      assertEquals((taken.jobId,taken.owner,taken.targetEpoch),(id,"b",before))
      val refused=intercept[java.util.concurrent.ExecutionException](rebuilding.get).getCause
      assertEquals(refused match { case error: DomainError => error.code; case other => other.toString },"conflict","the waiting rebuild saw the claim's commit")
      assertEquals(target(db,"b"),before)
      assert(a.renew(taken,300),"the claim of the current epoch holds")
      Fixtures.rebuild(db,"b")
      assert(target(db,"b")>before)
      assert(!a.renew(taken,300),"the rebuild fenced the claim of the replaced epoch")
      assertEquals((row(db,id).state,row(db,id).bulk),("Queued",Some(true)))
      val again=claimed(claim(a,bulkLane))
      assertEquals((again.jobId,again.targetEpoch),(id,target(db,"b")))
      assert(a.renew(again,300))
    } finally rebuild.close()
  }}

  test("T6 (D-g): an indexing-preference change of the candidate's owner, begun while the claim holds its pairs, waits for the claim; the claim commits under the then current indexing epoch, and the next claim replaces that attempt under the new epoch without a charge") { database { (c,db,a) =>
    val id=job(db,a,"c",1,true); job(db,a,"a",2,true)
    val before=indexingEpoch(db,"c")
    val writer=other(c)
    try withPool(2) { pool =>
      val pause=new Pause
      val claiming=async(pool)(ClaimOrder.claim(a,a.knownProfiles,ClaimScope.AllOwners,300,bulkLane,pause))
      awaited(pause.reached,"the claim never reached its candidate")
      val changing=async(pool)(writer.transaction { w =>
        val store=IndexingPreferenceSql.store(w,IndexingService.Chronicle,c.indexingPolicy)
        store.setChoice("c",IndexingChoice.Disable); store.setChoice("c",IndexingChoice.Enable); ()
      })
      assert(reachesLockWait(db,changing),"the preference change waits for the claim's shared lock on c's preference")
      assertEquals(indexingEpoch(db,"c"),before)
      pause.release.countDown()
      val taken=claimed(claiming.get)
      changing.get
      assertEquals((taken.jobId,taken.indexingEpoch,row(db,id).indexingEpoch),(id,before,before))
      val after=indexingEpoch(db,"c"); assert(after>before)
      assert(!a.renew(taken,300),"the attempt of the replaced indexing epoch lost its authority")
      val replaced=claimed(claim(a,bulkLane))
      assertEquals((replaced.jobId,replaced.indexingEpoch,replaced.facts.map(_.invalidated)),(id,after,Some(true)))
      assertEquals(row(db,id).attempts,1,"the invalidated attempt is not charged again")
    } finally writer.close()
  }}

  test("T6: lane B's candidate statement saw J queued, lane A's claim of J committed before B's job lock: B never overwrites A's claim and takes the next job") { database { (c,db,a) =>
    val j=job(db,a,"a",1,false); val next=job(db,a,"b",2,false)
    val laneA=other(c)
    try {
      var claimedByA=false
      // Lane A's committed claim of J (claimHead's transition): A locked J's source before B's statement did and committed
      // after B's snapshot, so B's statement returned J as it was queued.
      val race=new ClaimOrder.Race { def afterCandidate(job: UUID): Unit = if(job==j && !claimedByA) {
        claimedByA=true
        laneA.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET state='Running',attempts=attempts+1,fence=fence+1,lease_until=clock_timestamp()+interval '5 minutes',completed_windows=0,total_windows=NULL WHERE id=?",j))
      }}
      val laneB=claimed(ClaimOrder.claim(a,a.knownProfiles,ClaimScope.AllOwners,300,freshLane2,race))
      assert(claimedByA)
      assertEquals(laneB.jobId,next)
      assertEquals((row(db,j).state,row(db,j).attempts,row(db,j).fence),("Running",1,1L),"A's claim stands as A wrote it")
    } finally laneA.close()
  }}
}
