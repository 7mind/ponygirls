package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.util.UUID

abstract class AnnotationAttemptsContract extends munit.FunSuite {
  def withFixture(run: CheckpointFixture => Unit): Unit
  private val reason="annotation-partition-incomplete"
  private def claim(f: CheckpointFixture): Claim = f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300).get
  private def key(c: Claim,window: Int): CheckpointKey = IndexCheckpoints.key(c,IndexingStage.Annotation,window,0,"synthetic-policy",Json.fromInt(window))

  test("BG/GoodCommunication: validation reservations and idempotent rejection records survive reclaim without extending an old fence") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val first=claim(f); val selected=key(first,0)
    assertEquals(f.archive.reserveAnnotation(first,selected),AnnotationReservation.Reserved(1))
    assertEquals(f.archive.rejectAnnotation(first,selected,1,reason),1)
    assertEquals(f.archive.rejectAnnotation(first,selected,1,reason),1)
    assertEquals(intercept[DomainError](f.archive.rejectAnnotation(first,selected,1,"annotation-token-limit")).code,"internal")
    f.expire(first)
    assertEquals(intercept[DomainError](f.archive.reserveAnnotation(first,selected)).code,"stale-claim")
    assertEquals(intercept[DomainError](f.archive.rejectAnnotation(first,selected,1,reason)).code,"stale-claim")
    val next=claim(f); assertEquals(next.runId,first.runId)
    assertEquals(intercept[DomainError](f.archive.rejectAnnotation(next,selected,1,reason)).code,"internal","new claims must not label another fence's unknown outcome")
    assertEquals(intercept[DomainError](f.archive.reserveAnnotation(next,selected.copy(inputHash=Wire.hash("other input")))).code,"internal")
    assertEquals(f.archive.reserveAnnotation(next,key(next,0)),AnnotationReservation.Reserved(2))
    assertEquals(f.archive.rejectAnnotation(next,key(next,0),2,reason),2)
    assertEquals(f.archive.reserveAnnotation(next,key(next,1)),AnnotationReservation.Reserved(1))
  }}
  test("BG/GoodCommunication: a crash after the fifth rejection cannot create another provider authorization") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val first=claim(f)
    (1 to AnnotationAttempts.rejectionLimit).foreach { attempt =>
      assertEquals(f.archive.reserveAnnotation(first,key(first,0)),AnnotationReservation.Reserved(attempt))
      assertEquals(f.archive.rejectAnnotation(first,key(first,0),attempt,reason),attempt)
    }
    f.expire(first)
    val next=claim(f)
    assertEquals(f.archive.reserveAnnotation(next,key(next,0)),AnnotationReservation.Exhausted(reason,5))
    f.archive.fail(next,AnnotationAttempts.exhaustedCode,IndexingStage.Annotation)
    assertEquals(f.failureStage(next.jobId),Some(IndexingStage.Annotation))
    assertEquals(f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300),None)
  }}
  test("BG/GoodCommunication: explicit retry resets only the budget epoch and preserves accepted checkpoints") { withFixture { f =>
    val receipt=f.archive.ingest("a",Fixtures.snapshot()); val first=claim(f)
    val accepted=key(first,1); val output=Json.obj("accepted"->Json.True)
    f.archive.checkpoint(first,accepted,output)
    (1 to AnnotationAttempts.rejectionLimit).foreach { attempt =>
      f.archive.reserveAnnotation(first,key(first,0)); f.archive.rejectAnnotation(first,key(first,0),attempt,reason)
    }
    f.archive.fail(first,AnnotationAttempts.exhaustedCode,IndexingStage.Annotation)
    f.retry(receipt.jobId); val next=claim(f)
    assertEquals(next.runId,first.runId)
    assertEquals(f.archive.checkpoint(next,key(next,1)),Some(output))
    assertEquals(f.archive.reserveAnnotation(next,key(next,0)),AnnotationReservation.Reserved(1))
    assert(f.archive.publish(next,Nil))
    f.retry(receipt.jobId); val recompute=claim(f)
    assert(recompute.runId!=next.runId)
    assertEquals(f.archive.reserveAnnotation(recompute,key(recompute,0)),AnnotationReservation.Reserved(1))
    assertEquals(f.archive.checkpoint(recompute,key(recompute,1)),None)
  }}
  test("BG/GoodCommunication: infrastructure interruptions and validation rejections have separate bounded budgets") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot())
    (1 until Jobs.attemptLimit).foreach { attempt =>
      val current=claim(f)
      assertEquals(f.archive.reserveAnnotation(current,key(current,0)),AnnotationReservation.Reserved(attempt))
      f.archive.fail(current,"model-timeout",IndexingStage.Annotation)
    }
    val last=claim(f)
    (1 to AnnotationAttempts.rejectionLimit).foreach { rejected =>
      val reserved=Jobs.attemptLimit-1+rejected
      assertEquals(f.archive.reserveAnnotation(last,key(last,0)),AnnotationReservation.Reserved(reserved))
      assertEquals(f.archive.rejectAnnotation(last,key(last,0),reserved,reason),rejected)
    }
    assertEquals(f.archive.reserveAnnotation(last,key(last,0)),AnnotationReservation.Exhausted(reason,9))
    f.archive.fail(last,AnnotationAttempts.exhaustedCode,IndexingStage.Annotation)
    assertEquals(f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300),None)
  }}
  test("BG/GoodCommunication: competing reservations remain unique and the independent authorization backstop is finite") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val current=claim(f); val selected=key(current,0)
    val results=List.fill(AnnotationAttempts.reservationLimit+2)(IO.blocking(f.archive.reserveAnnotation(current,selected))).parSequence.unsafeRunSync()
    val reserved=results.collect { case AnnotationReservation.Reserved(attempt) => attempt }.sorted
    assertEquals(reserved,(1 to AnnotationAttempts.reservationLimit).toList)
    assertEquals(results.count(_==AnnotationReservation.Exhausted(AnnotationAttempts.callLimitReason,AnnotationAttempts.reservationLimit)),2)
    f.archive.fail(current,AnnotationAttempts.reservationExhaustedCode,IndexingStage.Annotation)
    assertEquals(f.archive.claim(f.archive.knownProfiles,ClaimScope.Owner("a"),300),None)
  }}
  test("BG/GoodCommunication: invalid keys, reasons and absent reservations fail closed without spending a budget") { withFixture { f =>
    f.archive.ingest("a",Fixtures.snapshot()); val current=claim(f); val selected=key(current,0)
    assertEquals(intercept[DomainError](f.archive.reserveAnnotation(current,selected.copy(stage=IndexingStage.Embedding))).code,"internal")
    assertEquals(intercept[DomainError](f.archive.rejectAnnotation(current,selected,1,reason)).code,"internal")
    assertEquals(f.archive.reserveAnnotation(current,selected),AnnotationReservation.Reserved(1))
    assertEquals(intercept[DomainError](f.archive.rejectAnnotation(current,selected,1,"private transcript text")).code,"internal")
    assertEquals(f.archive.rejectAnnotation(current,selected,1,reason),1)
    f.disable()
    assertEquals(intercept[DomainError](f.archive.reserveAnnotation(current,selected)).code,"stale-claim")
    assertEquals(intercept[DomainError](f.archive.rejectAnnotation(current,selected,1,reason)).code,"stale-claim")
  }}
}
final class DummyAnnotationAttemptsTest extends AnnotationAttemptsContract {
  def withFixture(run: CheckpointFixture => Unit): Unit = {
    val config=Fixtures.config(); val value=new DummyArchive(config,IndexProfileCatalog.current(config))
    run(new CheckpointFixture {
      val archive: SessionArchive=value
      def expire(claim: Claim): Unit=value.expireClaim(claim)
      def retry(id: UUID): Unit=value.retryJob(id)
      def disable(): Unit=value.setEnabled("a",false)
      def failureStage(id: UUID): Option[IndexingStage]=value.failureStage(id)
    })
  }
}
final class PostgresAnnotationAttemptsTest extends AnnotationAttemptsContract {
  test("GoodCommunication: confirmed bulk retry advances the budget epoch without deleting prior attempt evidence") {
    CurrentIndexDatabase.withDatabase { (_,db,archive) =>
      val receipt=archive.ingest("a",Fixtures.snapshot())
      val first=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
      def selected(c: Claim): CheckpointKey = IndexCheckpoints.key(c,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromInt(0))
      archive.reserveAnnotation(first,selected(first))
      archive.rejectAnnotation(first,selected(first),1,"annotation-partition-incomplete")
      archive.fail(first,AnnotationAttempts.exhaustedCode,IndexingStage.Annotation)
      val plan=db.transaction { c => c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ); RetryFailedJobs.preview(c,"a") }
      val result=db.transaction(c => RetryFailedJobs.apply(c,"a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true))
      assertEquals(result.retried,1L)
      val next=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
      assertEquals(next.runId,first.runId)
      assertEquals(archive.reserveAnnotation(next,selected(next)),AnnotationReservation.Reserved(1))
      val evidence=db.transaction(c => Sql.rows(c,"SELECT retry_epoch,rejection_reason FROM ch_annotation_attempts WHERE job_id=? ORDER BY retry_epoch",receipt.jobId)(r => (r.getLong(1),Option(r.getString(2)))))
      assertEquals(evidence,List((0L,Some("annotation-partition-incomplete")),(1L,None)))
    }
  }
  def withFixture(run: CheckpointFixture => Unit): Unit = CurrentIndexDatabase.withDatabase { (_,db,value) =>
    run(new CheckpointFixture {
      val archive: SessionArchive=value
      def expire(claim: Claim): Unit=db.transaction { c => Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",claim.jobId); () }
      def retry(id: UUID): Unit=db.transaction(c => Jobs.retry(c,"a",id))
      def disable(): Unit=db.transaction { c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='a'"); () }
      def failureStage(id: UUID): Option[IndexingStage]=db.transaction(c => Sql.one(c,"SELECT failure_stage FROM ch_jobs WHERE id=?",id)(r => Option(r.getString(1)).map(IndexingStage.valueOf)).flatten)
    })
  }
}
