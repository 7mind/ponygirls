package ontology.domain

import ontology.api.*

object CurationJournal {
  val JsonEncoding = "application/json"
  import CurationChecks.*
  def uncertain(entries: List[CurationAuditRecord]): Boolean = entries.lastOption.exists(_.stage == CurationAuditStage.DispatchPossible)
  def validate(claim: CurationClaim, entries: List[CurationAuditRecord], limits: CurationGuardLimits): Unit = {
    check(entries.size.toLong <= limits.maxOrdinals.toLong * 3L, "audit capacity exceeded")
    var previous = Option.empty[CurationAuditRecord]
    entries.foreach { entry =>
      check(entry.attemptId == claim.attemptId && entry.scope == claim.scope && entry.fence == claim.fence &&
        entry.ordinal > 0 && entry.ordinal <= limits.maxOrdinals, "audit identity mismatch")
      digest(entry.requestDigest)
      val observed = instant(entry.observedAt)
      val priorTime = previous.fold(instant(claim.claimedAt))(value => instant(value.observedAt))
      check(!observed.isBefore(priorTime), "audit time precedes retained evidence")
      entry.payload.foreach { value =>
        check(value.encoding == JsonEncoding, "unsupported audit payload encoding")
        payload(value, limits)
      }
      entry.stage match {
        case CurationAuditStage.RequestPrepared =>
          check(entry.payload.exists(_.digest == entry.requestDigest), "prepared request payload required")
          check(previous.fold(entry.ordinal == 1)(value => value.stage == CurationAuditStage.ResponseObserved && entry.ordinal.toLong == value.ordinal.toLong + 1L), "prepared ordinal gap")
        case CurationAuditStage.DispatchPossible =>
          check(entry.payload.isEmpty && previous.exists(value => value.ordinal == entry.ordinal && value.stage == CurationAuditStage.RequestPrepared &&
            value.requestDigest == entry.requestDigest), "dispatch ordering mismatch")
        case CurationAuditStage.ResponseObserved =>
          check(entry.payload.nonEmpty && previous.exists(value => value.ordinal == entry.ordinal && value.stage == CurationAuditStage.DispatchPossible &&
            value.requestDigest == entry.requestDigest), "response ordering mismatch")
      }
      previous = Some(entry)
    }
  }

  private[ontology] def existing(entries: List[CurationAuditRecord], incoming: CurationAuditRecord): Boolean = {
    entries.find(value => value.ordinal == incoming.ordinal && value.stage == incoming.stage) match {
      case None => false
      case Some(value) =>
        Require(value.copy(observedAt = incoming.observedAt) == incoming, "replay-conflict", "audit key has different content")
        true
    }
  }
}
