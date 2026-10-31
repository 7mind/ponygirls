package chronicle

import java.sql.Connection

enum AnnotationReservation {
  case Reserved(attempt: Int)
  case Exhausted(reason: String,attempts: Int)
}
object AnnotationAttempts {
  val rejectionLimit=5
  // Reserve room for interrupted/transport-failed calls without resetting the validation budget.
  val reservationLimit=rejectionLimit+Jobs.attemptLimit
  val exhaustedCode="annotation-attempts-exhausted"
  val reservationExhaustedCode="annotation-reservations-exhausted"
  def terminal(code: String): Boolean = code==exhaustedCode || code==reservationExhaustedCode
  val callLimitReason="annotation-call-limit"
  def validate(key: CheckpointKey): Unit =
    Check(key.stage==IndexingStage.Annotation && key.part==0,"internal","annotation attempt requires an annotation window key")
  def validateReason(reason: String): Unit =
    Check(reason.matches("[a-z][a-z0-9-]{0,63}"),"internal","invalid annotation rejection reason")
  private def epoch(c: Connection,claim: Claim): Long = {
    val value=Sql.one(c,"SELECT annotation_retry_epoch FROM ch_jobs WHERE id=?",claim.jobId)(_.getLong(1)).get
    Check(value>=0,"internal","invalid annotation retry epoch")
    value
  }
  private[chronicle] def reserve(c: Connection,claim: Claim,key: CheckpointKey): AnnotationReservation = {
    validate(key)
    val currentEpoch=epoch(c,claim)
    val previous=Sql.rows(c,"""SELECT attempt,input_hash,rejection_reason FROM ch_annotation_attempts
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? ORDER BY attempt""",claim.jobId,claim.runId,currentEpoch,key.window) { r =>
      (r.getInt(1),r.getString(2),Option(r.getString(3)))
    }
    Check(previous.size<=reservationLimit && previous.map(_._1)==(1 to previous.size).toList && previous.forall(_._2==key.inputHash),"internal","annotation attempt input identity mismatch")
    val rejected=previous.flatMap(_._3)
    rejected.foreach(validateReason)
    Check(rejected.size<=rejectionLimit,"internal","invalid annotation rejection count")
    if(rejected.size==rejectionLimit) AnnotationReservation.Exhausted(rejected.last,previous.size)
    else if(previous.size>=reservationLimit) AnnotationReservation.Exhausted(callLimitReason,previous.size)
    else {
      val attempt=previous.size+1
      Sql.exec(c,"""INSERT INTO ch_annotation_attempts(job_id,run_id,retry_epoch,window_ordinal,attempt,input_hash,fence)
        VALUES(?,?,?,?,?,?,?)""",claim.jobId,claim.runId,currentEpoch,key.window,attempt,key.inputHash,claim.fence)
      AnnotationReservation.Reserved(attempt)
    }
  }
  private[chronicle] def reject(c: Connection,claim: Claim,key: CheckpointKey,attempt: Int,reason: String): Int = {
    validate(key); validateReason(reason)
    Check(attempt>=1 && attempt<=reservationLimit,"internal","invalid annotation reservation")
    val currentEpoch=epoch(c,claim)
    val changed=Sql.exec(c,"""UPDATE ch_annotation_attempts SET rejection_reason=?
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? AND attempt=? AND input_hash=? AND fence=?
        AND (rejection_reason IS NULL OR rejection_reason=?)""",reason,claim.jobId,claim.runId,currentEpoch,key.window,attempt,key.inputHash,claim.fence,reason)
    Check(changed==1,"internal","annotation rejection reservation mismatch")
    val rejected=Sql.one(c,"""SELECT count(*) FROM ch_annotation_attempts
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? AND rejection_reason IS NOT NULL""",claim.jobId,claim.runId,currentEpoch,key.window)(_.getInt(1)).get
    Check(rejected<=rejectionLimit,"internal","invalid annotation rejection count")
    rejected
  }
}
