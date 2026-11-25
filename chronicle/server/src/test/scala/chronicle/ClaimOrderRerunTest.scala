package chronicle

import chronicle.api.*
import java.util.UUID
import scala.concurrent.duration.*

/** T7 (claim-order DESIGN §9; spec R6): cases of today's suites rerun under the waiting order (`indexing.claimOrder`
  * "waiting"), every claim through ClaimOrder: holds, attempts, lease exhaustion, start-up supersession and the older-Running
  * wait (PostgresBehaviorTest, TransientPublicationTest A2). The suites themselves stay as they are, under the default order. */
final class ClaimOrderRerunTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  private def job(a: PostgresArchive,id: UUID): (JobState,Option[String]) = a.statuses("a",0,100).jobs.find(_.id==id).map(job => (job.state,job.error)).get
  private def revise(a: PostgresArchive,request: IngestRequest,head: Int): IngestReceipt = a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=head))
  private def any(c: Config,a: PostgresArchive,lease: Int = 300): Option[Claim] = claimAs(c,a,Set(c.profile),ClaimScope.AllOwners,lease)

  test("T7 (TransientPublicationTest A2): a held job, the oldest of all, is claimed by no lane until its time has come, then by its lane's order") { database { (c,db,a) =>
    val held=ClaimOrderFixtures.job(db,a,"a",0,false)
    val first=claimed(claim(a,freshLane))
    assertEquals(first.jobId,held)
    assert(a.holdTransient(first,Some(IndexingStage.Publication),Deadline.now+30.seconds).isInstanceOf[TransientOutcome.Held])
    assertEquals((row(db,held).state,row(db,held).attempts),("Queued",0))
    val younger=ClaimOrderFixtures.job(db,a,"b",5,false)
    assertEquals(taken(a,lane0),younger,"lane 0 passes the held job for a younger one")
    for(lane <- List(lane0,bulkLane,freshLane,freshLane2)) assertEquals(claim(a,lane),ClaimOutcome.Idle,s"lane ${lane.index} refuses the held job")
    db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET lease_until=clock_timestamp() WHERE id=? AND state='Queued'",held))
    assertEquals(taken(a,freshLane),held)
  }}

  test("T7 (PostgresBehaviorTest): resumed heads terminalize superseded Queued jobs") { database { (c,db,a) =>
    val request=Fixtures.snapshot(); val old=a.ingest("a",request)
    revise(a,request,1)
    val current=any(c,a).get; assertEquals(current.revision,2); assert(a.publish(current,Nil))
    assertEquals(any(c,a),None)
    assertEquals(job(a,old.jobId),(JobState.Failed,Some(Jobs.supersededRevision)))
    assertEquals(job(a,current.jobId),(JobState.Complete,None))
  }}

  test("T7 (PostgresBehaviorTest): a Running job with a valid lease survives newer heads and publishes its revision; the head job waits for it") { database { (c,db,a) =>
    val request=Fixtures.snapshot(); val first=a.ingest("a",request)
    val running=any(c,a).get
    val second=revise(a,request,1); val third=revise(a,request,2)
    assertEquals(job(a,second.jobId),(JobState.Failed,Some(Jobs.supersededRevision)),"the next ingest supersedes a queued head job")
    for(lane <- List(lane0,bulkLane,freshLane)) assertEquals(claim(a,lane),ClaimOutcome.Idle,"the head job waits while a job of its source is Running")
    val key=IndexCheckpoints.key(running,IndexingStage.Annotation,0,0,ProblemPassages.identity,io.circe.Json.fromString("window"))
    assert(a.renew(running,300)); assert(a.progress(running,1,1))
    a.checkpoint(running,key,io.circe.Json.fromString("accepted")); assertEquals(a.checkpoint(running,key),Some(io.circe.Json.fromString("accepted")))
    assert(a.publish(running,Nil))
    assertEquals(job(a,first.jobId),(JobState.Complete,None)); assertEquals(a.session("a",first.sessionId).indexedRevision,Some(1))
    val head=any(c,a).get; assertEquals(head.jobId,third.jobId)
    assert(a.publish(head,Nil)); assertEquals(a.session("a",first.sessionId).indexedRevision,Some(3))
  }}

  test("T7 (PostgresBehaviorTest): five failed attempts fail the job; no lane claims it again; a retry queues it afresh") { database { (c,db,a) =>
    val out=a.ingest("a",Fixtures.snapshot())
    (1 to 5).foreach(n => a.fail(claimed(claim(a,if(n%2==0) lane0 else freshLane)),"model-http"))
    assertEquals(job(a,out.jobId)._1,JobState.Failed)
    assertEquals(row(db,out.jobId).attempts,5)
    for(lane <- List(lane0,bulkLane,freshLane)) assertEquals(claim(a,lane),ClaimOutcome.Idle)
    a.retry("a",out.jobId)
    assertEquals(taken(a,freshLane),out.jobId)
  }}

  test("T7 (PostgresBehaviorTest): expired leases fence old workers; the final crashed attempt becomes a visible lease-exhausted failure") { database { (c,db,a) =>
    val out=a.ingest("a",Fixtures.snapshot())
    val old=any(c,a,0).get
    val fresh=any(c,a,0).get
    assert(fresh.fence>old.fence); assert(!a.publish(old,Nil))
    (1 to 3).foreach(_ => assert(any(c,a,0).isDefined))
    for(lane <- List(lane0,bulkLane,freshLane)) assertEquals(claim(a,lane,lease=0),ClaimOutcome.Idle)
    assertEquals(job(a,out.jobId),(JobState.Failed,Some("lease-exhausted")))
    a.retry("a",out.jobId); assert(any(c,a).isDefined)
  }}

  test("T7 (PostgresBehaviorTest): start-up supersession ends pre-existing obsolete unfinished jobs without rewriting terminal verdicts; the waiting order then claims the head") { database { (c,db,a) =>
    def revise(request: IngestRequest,head: Int): IngestReceipt = a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=head))
    val request=Fixtures.snapshot(); val first=a.ingest("a",request)
    assert(a.publish(any(c,a).get,Nil))
    val published=a.session("a",first.sessionId).view
    val second=revise(request,1); val third=revise(request,2)
    a.fail(any(c,a).get,IndexingBudget.exceededCode,IndexingStage.Embedding)
    val fourth=revise(request,3)
    val verdict=a.statuses("a",0,100).jobs.find(_.id==third.jobId).get
    assertEquals((verdict.state,verdict.error,verdict.failureStage),(JobState.Failed,Some(IndexingBudget.exceededCode),Some(IndexingFailureStage.Embedding)))
    db.transaction(x => Sql.exec(x,"UPDATE ch_jobs SET state='Running',error='model-timeout',failure_stage='Embedding',lease_until=now()+interval '300 seconds' WHERE id=?",second.jobId))
    db.initialize()
    val jobs=a.statuses("a",0,100).jobs
    assertEquals((jobs.find(_.id==second.jobId).get.state,jobs.find(_.id==second.jobId).get.error,jobs.find(_.id==second.jobId).get.failureStage),(JobState.Failed,Some("superseded-revision"),None))
    assertEquals(jobs.find(_.id==third.jobId).get,verdict,"an older terminal job keeps its verdict and stage")
    assertEquals(jobs.find(_.id==first.jobId).get.state,JobState.Complete)
    assertEquals(a.readSession("a",first.sessionId,Some(published)).session.view,published)
    assertEquals(taken(a,freshLane),fourth.jobId)
  }}
}
