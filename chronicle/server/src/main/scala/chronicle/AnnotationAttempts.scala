package chronicle

import io.circe.Json
import java.sql.Connection
import java.util.UUID

enum AnnotationReservation {
  case Reserved(attempt: Int)
  case Exhausted(reason: String,attempts: Int)
}
/** An authorization row of a window in the job's current retry epoch (ANNOT2): its reason, and for a kept answer the hash
  * of the window's kept parts after it and its chain. */
final case class AnnotationLedgerRow(attempt: Int,reason: Option[String],keptHash: Option[String],chain: Option[UUID])
/** A window's kept parts as `continueAnnotation` stores them (ANNOT2, window coordinates): they cover the window's
  * fragments before `covered`, after `continuations` kept answers whose stops were `stops`, of chain `chain`. */
final case class AnnotationPartial(kept: ProblemPassages.Decision,windowFragments: Int,covered: Int,continuations: Int,stops: Vector[Int],chain: UUID) {
  val keptJson: Json = CheckpointJson.decision(kept)
  val keptHash: String = IndexCheckpoints.hash(keptJson)
}
/** A partial row as stored, not yet validated (`ProblemPassages.resumable` does). */
final case class StoredPartial(format: String,profile: String,contentHash: String,inputHash: String,attempt: Int,windowFragments: Int,coveredFragments: Int,
  continuations: Int,stops: Vector[Int],chain: UUID,kept: Json,keptHash: String)
/** What `loadPartial` finds for a window before its first authorization (ANNOT2). */
enum PartialLoad {
  /** The window's ledger is exhausted: nothing is loaded and no model is called. */
  case Exhausted(reason: String,attempts: Int)
  /** No partial: the window starts with the full request. `reasons`: the epoch's rows with a reason. */
  case Missing(reasons: Int)
  /** A partial row with the epoch's ledger rows and the window's active chain, for validation. */
  case Found(partial: StoredPartial,ledger: Vector[AnnotationLedgerRow],activeChain: Option[UUID])
}
object AnnotationAttempts {
  val rejectionLimit=5
  // Reserve room for interrupted/transport-failed calls without resetting the validation budget.
  val reservationLimit=rejectionLimit+Jobs.attemptLimit
  /** Kept answers per window chain (ANNOT2): each is a non-final answer, and the fifth non-final answer ends the window. */
  val continuationLimit=rejectionLimit-1
  val exhaustedCode="annotation-attempts-exhausted"
  val reservationExhaustedCode="annotation-reservations-exhausted"
  /** The window's authorizations of the epoch were reserved for another input (its source or carry changed under the run). */
  val inputChangedCode="annotation-input-changed"
  def terminal(code: String): Boolean = code==exhaustedCode || code==reservationExhaustedCode || code==inputChangedCode
  val callLimitReason="annotation-call-limit"
  /** An answer kept up to the fragment boundary it stopped at (ANNOT2). */
  val continuedReason="annotation-partition-continued"
  /** A boundary stop whose request for the rest of the window would exceed the request bounds. */
  val unrequestableReason="annotation-continuation-unrequestable"
  def validate(key: CheckpointKey): Unit =
    Check(key.stage==IndexingStage.Annotation && key.part==0,"internal","annotation attempt requires an annotation window key")
  def validateReason(reason: String): Unit =
    Check(reason.matches("[a-z][a-z0-9-]{0,63}"),"internal","invalid annotation rejection reason")
  private[chronicle] def epoch(c: Connection,claim: Claim): Long = {
    val value=Sql.one(c,"SELECT annotation_retry_epoch FROM ch_jobs WHERE id=?",claim.jobId)(_.getLong(1)).get
    Check(value>=0,"internal","invalid annotation retry epoch")
    value
  }
  /** The window's rows in the job's current retry epoch, in attempt order, with that epoch. */
  private[chronicle] def ledger(c: Connection,claim: Claim,key: CheckpointKey): (Long,Vector[AnnotationLedgerRow]) = {
    validate(key)
    val currentEpoch=epoch(c,claim)
    val previous=Sql.rows(c,"""SELECT attempt,input_hash,rejection_reason,continued_kept_hash,chain_id FROM ch_annotation_attempts
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? ORDER BY attempt""",claim.jobId,claim.runId,currentEpoch,key.window) { r =>
      (AnnotationLedgerRow(r.getInt(1),Option(r.getString(3)),Option(r.getString(4)),Option(r.getObject(5,classOf[UUID]))),r.getString(2))
    }
    Check(previous.size<=reservationLimit && previous.map(_._1.attempt)==(1 to previous.size).toList,"internal","annotation attempt input identity mismatch")
    if(!previous.forall(_._2==key.inputHash)) throw DomainError(inputChangedCode,"annotation window input changed")
    val rows=previous.map(_._1).toVector
    val rejected=rows.flatMap(_.reason)
    rejected.foreach(validateReason)
    Check(rejected.size<=rejectionLimit,"internal","invalid annotation rejection count")
    (currentEpoch,rows)
  }
  /** The reason and row count of an exhausted ledger. */
  private[chronicle] def exhaustion(rows: Vector[AnnotationLedgerRow]): Option[(String,Int)] = {
    val rejected=rows.flatMap(_.reason)
    if(rejected.size==rejectionLimit) Some((rejected.last,rows.size))
    else if(rows.size>=reservationLimit) Some((callLimitReason,rows.size))
    else None
  }
  private[chronicle] def reserve(c: Connection,claim: Claim,key: CheckpointKey): AnnotationReservation = {
    val (currentEpoch,previous)=ledger(c,claim,key)
    exhaustion(previous) match {
      case Some((reason,attempts)) => AnnotationReservation.Exhausted(reason,attempts)
      case None =>
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
    rejected(c,claim,currentEpoch,key)
  }
  /** A kept answer's row (ANNOT2): reason continued, the hash of the window's kept parts after it, and its chain. */
  private[chronicle] def continued(c: Connection,claim: Claim,key: CheckpointKey,attempt: Int,keptHash: String,chain: UUID): Int = {
    validate(key)
    Check(attempt>=1 && attempt<=reservationLimit,"internal","invalid annotation reservation")
    val currentEpoch=epoch(c,claim)
    val changed=Sql.exec(c,"""UPDATE ch_annotation_attempts SET rejection_reason=?,continued_kept_hash=?,chain_id=?
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? AND attempt=? AND input_hash=? AND fence=?
        AND (rejection_reason IS NULL OR (rejection_reason=? AND continued_kept_hash=? AND chain_id=?))""",
      continuedReason,keptHash,chain,claim.jobId,claim.runId,currentEpoch,key.window,attempt,key.inputHash,claim.fence,continuedReason,keptHash,chain)
    Check(changed==1,"internal","annotation continuation reservation mismatch")
    rejected(c,claim,currentEpoch,key)
  }
  /** The accepting reservation's provenance (ANNOT2): the window was accepted after `continuations` kept answers. */
  private[chronicle] def accept(c: Connection,claim: Claim,key: CheckpointKey,attempt: Int,continuations: Int): Unit = {
    validate(key)
    Check(attempt>=1 && attempt<=reservationLimit && continuations>=0 && continuations<=continuationLimit,"internal","invalid annotation acceptance")
    val changed=Sql.exec(c,"""UPDATE ch_annotation_attempts SET accepted_continuations=?
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? AND attempt=? AND input_hash=? AND fence=?
        AND rejection_reason IS NULL AND (accepted_continuations IS NULL OR accepted_continuations=?)""",
      continuations,claim.jobId,claim.runId,epoch(c,claim),key.window,attempt,key.inputHash,claim.fence,continuations)
    Check(changed==1,"internal","annotation acceptance reservation mismatch")
  }
  private def rejected(c: Connection,claim: Claim,currentEpoch: Long,key: CheckpointKey): Int = {
    val rejected=Sql.one(c,"""SELECT count(*) FROM ch_annotation_attempts
      WHERE job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=? AND rejection_reason IS NOT NULL""",claim.jobId,claim.runId,currentEpoch,key.window)(_.getInt(1)).get
    Check(rejected<=rejectionLimit,"internal","invalid annotation rejection count")
    rejected
  }
}
/** The kept parts of a window's unfinished chain (ANNOT2, migration 031) and the window's active chain: written only in a
  * claim's fenced transactions, read only by `loadPartial`. */
object AnnotationPartials {
  val format="annotation-partial-v1"
  private val window="job_id=? AND run_id=? AND retry_epoch=? AND window_ordinal=?"
  private[chronicle] def read(c: Connection,claim: Claim,epoch: Long,ordinal: Int): Option[StoredPartial] =
    Sql.one(c,s"""SELECT format,profile,content_hash,input_hash,attempt,window_fragments,covered_fragments,continuations,stops,chain_id,kept::text,kept_hash
      FROM ch_annotation_partials WHERE $window""",claim.jobId,claim.runId,epoch,ordinal) { r =>
      val stops=r.getArray("stops").getArray.asInstanceOf[Array[java.lang.Integer]].toVector.map(stop => Option(stop).fold(-1)(_.intValue))
      StoredPartial(r.getString("format"),r.getString("profile"),r.getString("content_hash"),r.getString("input_hash"),r.getInt("attempt"),r.getInt("window_fragments"),
        r.getInt("covered_fragments"),r.getInt("continuations"),stops,r.getObject("chain_id",classOf[UUID]),Wire.parse(r.getString("kept")),r.getString("kept_hash"))
    }
  private[chronicle] def activeChain(c: Connection,claim: Claim,epoch: Long,ordinal: Int): Option[UUID] =
    Sql.one(c,s"SELECT active_chain FROM ch_annotation_active_chains WHERE $window",claim.jobId,claim.runId,epoch,ordinal)(r => Option(r.getObject(1,classOf[UUID]))).flatten
  /** The chain's next state: a first row, or the row of its previous kept answer extended. */
  private[chronicle] def write(c: Connection,claim: Claim,key: CheckpointKey,epoch: Long,attempt: Int,partial: AnnotationPartial): Unit = {
    val content=key.contentHash.getOrElse(throw DomainError("internal","annotation partial requires a content hash"))
    val changed=Sql.exec(c,"""INSERT INTO ch_annotation_partials(job_id,run_id,retry_epoch,window_ordinal,profile,content_hash,input_hash,attempt,window_fragments,
        covered_fragments,continuations,stops,chain_id,format,kept,kept_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?::integer[],?,?,?::jsonb,?)
      ON CONFLICT(job_id,run_id,retry_epoch,window_ordinal) DO UPDATE SET profile=EXCLUDED.profile,content_hash=EXCLUDED.content_hash,input_hash=EXCLUDED.input_hash,
        attempt=EXCLUDED.attempt,window_fragments=EXCLUDED.window_fragments,covered_fragments=EXCLUDED.covered_fragments,continuations=EXCLUDED.continuations,
        stops=EXCLUDED.stops,chain_id=EXCLUDED.chain_id,format=EXCLUDED.format,kept=EXCLUDED.kept,kept_hash=EXCLUDED.kept_hash
      WHERE ch_annotation_partials.covered_fragments<EXCLUDED.covered_fragments AND ch_annotation_partials.continuations=EXCLUDED.continuations-1""",
      claim.jobId,claim.runId,epoch,key.window,claim.profile,content,key.inputHash,attempt,partial.windowFragments,partial.covered,partial.continuations,
      partial.stops.mkString("{",",","}"),partial.chain,format,partial.keptJson.noSpaces,partial.keptHash)
    Check(changed==1,"internal","annotation partial does not extend its chain")
    Sql.exec(c,s"""INSERT INTO ch_annotation_active_chains(job_id,run_id,retry_epoch,window_ordinal,active_chain) VALUES(?,?,?,?,?)
      ON CONFLICT(job_id,run_id,retry_epoch,window_ordinal) DO UPDATE SET active_chain=EXCLUDED.active_chain""",claim.jobId,claim.runId,epoch,key.window,partial.chain)
    ()
  }
  /** No chain of the window may resume (a discard, or a full-window request). */
  private[chronicle] def clear(c: Connection,claim: Claim,epoch: Long,ordinal: Int): Unit = {
    Sql.exec(c,s"UPDATE ch_annotation_active_chains SET active_chain=NULL WHERE $window",claim.jobId,claim.runId,epoch,ordinal); ()
  }
  private[chronicle] def discard(c: Connection,claim: Claim,epoch: Long,ordinal: Int): Unit = {
    Sql.exec(c,s"DELETE FROM ch_annotation_partials WHERE $window",claim.jobId,claim.runId,epoch,ordinal)
    clear(c,claim,epoch,ordinal)
  }
  /** The window accepted: its partials and chain markers of every run and epoch of the job go. */
  private[chronicle] def accepted(c: Connection,claim: Claim,ordinal: Int): Unit = {
    Sql.exec(c,"DELETE FROM ch_annotation_partials WHERE job_id=? AND window_ordinal=?",claim.jobId,ordinal)
    Sql.exec(c,"DELETE FROM ch_annotation_active_chains WHERE job_id=? AND window_ordinal=?",claim.jobId,ordinal)
    ()
  }
}
