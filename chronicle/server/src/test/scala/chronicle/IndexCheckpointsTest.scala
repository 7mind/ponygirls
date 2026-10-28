package chronicle

import chronicle.api.*
import io.circe.Json
import java.util.UUID

trait CheckpointFixture {
  def archive: SessionArchive
  def expire(claim: Claim): Unit
  def retry(id: UUID): Unit
  def disable(): Unit
  def failureStage(id: UUID): Option[IndexingStage]
}
// Specified behavioral contract: small durable accepted-work store, not a simulated transaction engine.
abstract class IndexCheckpointsContract extends munit.FunSuite {
  def withFixture(run: CheckpointFixture => Unit): Unit
  private val value=Json.obj("accepted"->Json.fromString("synthetic"))
  private def key(claim: Claim): CheckpointKey = IndexCheckpoints.key(claim,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromString("exact input"))
  private def claim(f: CheckpointFixture): Claim = f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get
  // Regression hypothesis: JSONB rewrites numeric lexemes; accepted vector identity must survive storage.
  test("BG/GoodCommunication: accepted finite vectors roundtrip scientific notation negative zero and normal floats") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val current=claim(f)
    val selected=IndexCheckpoints.key(current,IndexingStage.Embedding,0,0,"synthetic-embedding",Json.fromString("exact slice"))
    val vectors=List(List(1e-10,-0.0,1.25),List(1e20,2.5,-3.0))
    val encoded=CheckpointJson.vectors(vectors)
    f.archive.checkpoint(current,selected,encoded)
    val restored=f.archive.checkpoint(current,selected).get
    assertEquals(CheckpointJson.vectors(restored),vectors)
    assertEquals(CheckpointJson.vectors(restored).map(_.map(java.lang.Double.doubleToRawLongBits)),vectors.map(_.map(java.lang.Double.doubleToRawLongBits)))
    f.archive.checkpoint(current,selected,encoded)
  }}
  test("BG/GoodCommunication: immutable accepted output survives automatic retry and fence changes in one run") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val first=claim(f); val selected=key(first)
    assertEquals(f.archive.checkpoint(first,selected),None)
    f.archive.checkpoint(first,selected,value); f.archive.checkpoint(first,selected,value)
    f.archive.fail(first,"model-timeout",IndexingStage.Embedding)
    assertEquals(f.failureStage(first.jobId),Some(IndexingStage.Embedding))
    val next=claim(f); assertEquals(next.runId,first.runId); assert(next.fence>first.fence)
    assertEquals(f.failureStage(first.jobId),Some(IndexingStage.Embedding),"queued/running failure context is historical, not the current stage")
    assertEquals(f.archive.checkpoint(next,key(next)),Some(value))
    List(first,next.copy(owner="b"),next.copy(runId=UUID.randomUUID()),next.copy(targetEpoch=next.targetEpoch+1),next.copy(profile="unknown"),next.copy(fence=next.fence+1),next.copy(revision=99),next.copy(snapshot=next.snapshot.copy(redacted = !next.snapshot.redacted))).foreach { stale =>
      assertEquals(intercept[DomainError](f.archive.checkpoint(stale,selected)).code,"stale-claim")
      assertEquals(intercept[DomainError](f.archive.checkpoint(stale,selected,value)).code,"stale-claim")
      assert(!f.archive.publish(stale,Nil))
    }
    assertEquals(intercept[DomainError](f.archive.checkpoint(next,selected.copy(inputHash=Wire.hash("wrong input")))).code,"internal")
    assertEquals(intercept[DomainError](f.archive.checkpoint(next,selected,Json.Null)).code,"internal")
    assertEquals(f.archive.checkpoint(next,selected),Some(value))
  }}
  test("BG/GoodCommunication: expired lease is denial, later reclaim reuses accepted work without extending old authority") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val first=claim(f); f.archive.checkpoint(first,key(first),value)
    f.expire(first)
    assertEquals(intercept[DomainError](f.archive.checkpoint(first,key(first))).code,"stale-claim")
    assertEquals(intercept[DomainError](f.archive.checkpoint(first,key(first),value)).code,"stale-claim")
    val next=claim(f); assertEquals(next.runId,first.runId)
    assertEquals(f.archive.checkpoint(next,key(next)),Some(value))
    f.disable()
    assertEquals(intercept[DomainError](f.archive.checkpoint(next,key(next))).code,"stale-claim")
    assertEquals(intercept[DomainError](f.archive.checkpoint(next,key(next),value)).code,"stale-claim")
  }}
  test("BG/GoodCommunication: explicit failed retry preserves accepted work, Complete recompute starts a new run") { withFixture { f =>
    val out=f.archive.ingest("a",Fixtures.snapshot()); val first=claim(f)
    f.archive.checkpoint(first,key(first),value); f.archive.fail(first,"model-timeout",IndexingStage.Annotation)
    f.retry(out.jobId); val retry=claim(f)
    assertEquals(retry.runId,first.runId); assertEquals(f.archive.checkpoint(retry,key(retry)),Some(value))
    assert(f.archive.publish(retry,Nil))
    f.retry(out.jobId); val recompute=claim(f)
    assert(recompute.runId!=retry.runId)
    assertEquals(f.archive.checkpoint(recompute,key(recompute)),None)
    assertEquals(intercept[DomainError](f.archive.checkpoint(retry,key(retry))).code,"stale-claim")
  }}
  test("BG/GoodCommunication: append supersedes checkpoint access without erasing the published pin") { withFixture { f =>
    val original=Fixtures.snapshot(); val out=f.archive.ingest("a",original); val first=claim(f)
    f.archive.checkpoint(first,key(first),value); assert(f.archive.publish(first,Nil))
    val pin=f.archive.session("a",out.sessionId).view
    f.archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assertEquals(intercept[DomainError](f.archive.checkpoint(first,key(first))).code,"stale-claim")
    assertEquals(f.archive.session("a",out.sessionId).view,pin)
    val next=claim(f); assert(next.runId!=first.runId); assertEquals(f.archive.checkpoint(next,key(next)),None)
  }}
}
final class DummyIndexCheckpointsTest extends IndexCheckpointsContract {
  def withFixture(run: CheckpointFixture => Unit): Unit = {
    val config=Fixtures.config(); val value=new DummyArchive(config,IndexProfileCatalog.legacyOnly(config))
    run(new CheckpointFixture {
      val archive: SessionArchive=value
      def expire(claim: Claim): Unit=value.expireClaim(claim)
      def retry(id: UUID): Unit=value.retryJob(id)
      def disable(): Unit=value.setEnabled("a",false)
      def failureStage(id: UUID): Option[IndexingStage]=value.failureStage(id)
    })
  }
}
final class PostgresIndexCheckpointsTest extends IndexCheckpointsContract {
  def withFixture(run: CheckpointFixture => Unit): Unit = OwnerProfilePostgres.withDatabase { (_,db,value,_) =>
    run(new CheckpointFixture {
      val archive: SessionArchive=value
      def expire(claim: Claim): Unit=db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",claim.jobId); () }
      def retry(id: UUID): Unit=db.transaction(c => Jobs.retry(c,"a",id))
      def disable(): Unit=db.transaction { c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"); () }
      def failureStage(id: UUID): Option[IndexingStage]=db.transaction(c => Sql.one(c,"SELECT failure_stage FROM ch_jobs WHERE id=?",id)(r => Option(r.getString(1)).map(IndexingStage.valueOf)).flatten)
    })
  }
}
