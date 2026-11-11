package ontology.domain

import ontology.api.*
import ontology.{Digests, Wire}
import java.time.Instant

final case class CurationAuditAppend(attempt: CurationAttempt, entries: List[CurationAuditRecord], replayed: Boolean)
object CurationGuards {
  import CurationChecks.*
  def active(state: CurationAttemptState): Boolean = Set(CurationAttemptState.Claimed, CurationAttemptState.InputSealed, CurationAttemptState.Running).contains(state)
  def lease(claim: CurationClaim, current: CoordinatorLease, now: Instant): Unit = {
    check(claim.fence == current.fence && current.fence.epoch > 0, "coordinator fence mismatch")
    val acquired = instant(current.acquiredAt); val renewed = instant(current.renewedAt); val expires = instant(current.expiresAt)
    check(!renewed.isBefore(acquired) && expires.isAfter(renewed) && !now.isBefore(renewed) && now.isBefore(expires), "coordinator lease unavailable")
  }
  def beforeDeadline(claim: CurationClaim, now: Instant): Unit =
    Require(now.isBefore(instant(claim.deadlineAt)), "curation-expired", "attempt admission deadline elapsed")
  def eligible(head: GraphSnapshot, maximumAttempted: Option[Long], hasActive: Boolean): Boolean = {
    Graph.validateCounters(head)
    check(maximumAttempted.forall(value => value >= 0 && value <= head.sourceFrontier), "invalid attempted frontier")
    !hasActive && head.sourceFrontier > head.coveredFrontier && maximumAttempted.forall(head.sourceFrontier > _)
  }
  private def claimShape(value: CurationClaim, limits: CurationGuardLimits): Unit = {
    check(value.admissionLimits == limits.toWire, "claim admission limits differ")
    label(value.scope, limits); label(value.profileId, limits)
    check(value.baseGeneration >= 0 && value.previousCoveredFrontier >= 0 && value.frontier > value.previousCoveredFrontier && value.fence.epoch > 0, "invalid claim coordinates")
    List(value.profileDigest, value.schemaDigest, value.graphDigest, value.sourceCutDigest).foreach(digest)
    check(instant(value.deadlineAt).isAfter(instant(value.claimedAt)), "invalid claim deadline")
  }
  def claim(value: CurationClaim, head: GraphSnapshot, sources: List[CapturedEvent], maximumAttempted: Option[Long], hasActive: Boolean,
            current: CoordinatorLease, now: Instant, limits: CurationGuardLimits): Unit = {
    claimShape(value, limits); lease(value, current, now)
    check(eligible(head, maximumAttempted, hasActive), "frontier is not eligible")
    check(instant(value.claimedAt) == now, "claim time is not the authoritative operation time")
    CurationMaterial.frozen(value, head, sources)
  }
  private def manifest(claim: CurationClaim, value: CurationInputManifest, limits: CurationGuardLimits): Unit = {
    check(value.attemptId == claim.attemptId && value.inputBytes > 0 && value.inputBytes <= limits.maxInputBytes, "invalid input manifest")
    label(value.encoding, limits); digest(value.inputDigest)
    check(!instant(value.sealedAt).isBefore(instant(claim.claimedAt)) && instant(value.sealedAt).isBefore(instant(claim.deadlineAt)), "seal is outside claim admission interval")
    check(value.seed.size.toLong + value.sources.size.toLong <= limits.maxPins && value.seed.map(_.ref).distinct.size == value.seed.size &&
      value.sources.map(_.ref).distinct.size == value.sources.size, "invalid manifest pin set")
    value.seed.foreach(pin => { check(pin.ref.revision > 0, "invalid record pin"); digest(pin.digest) })
    check(value.sources.size.toLong == claim.frontier - claim.previousCoveredFrontier, "incomplete manifest source cut")
    value.sources.zipWithIndex.foreach { case (pin, index) =>
      check(pin.ref.revision == 1 && pin.frontier == claim.previousCoveredFrontier + index.toLong + 1L, "invalid source pin")
      digest(pin.digest)
    }
  }
  private def candidate(attempt: CurationAttempt, entries: List[CurationAuditRecord], value: CurationCandidate): Unit = {
    val input = attempt.inputManifest.getOrElse(throw Fault("curation", "candidate has no input seal"))
    check(value.attemptId == attempt.claim.attemptId && value.inputDigest == input.inputDigest &&
      value.proposal.expectedGeneration == attempt.claim.baseGeneration && value.proposal.frontier == attempt.claim.frontier &&
      value.proposalDigest == Digests.text(Wire.encode(CurationProposal.codecJson, value.proposal).noSpaces), "candidate input/proposal binding mismatch")
    check(entries.lastOption.exists(entry => entry.stage == CurationAuditStage.ResponseObserved && entry.ordinal == value.responseOrdinal &&
      entry.payload.exists(_.digest == value.responseDigest)), "candidate does not bind the final observed response")
    val body = entries.last.payload.getOrElse(throw Fault("curation", "observed response payload missing"))
    val json = io.circe.parser.parse(body.content).fold(_ => throw Fault("curation", "invalid observed response JSON"), identity)
    check(json.noSpaces == body.content, "response audit is not canonical JSON")
    val decoded = try ontology.curation.CuratorResponse.proposal(attempt.claim.baseGeneration, attempt.claim.frontier, ontology.curation.CuratorResponse.envelope(json))
      catch { case _: Fault => throw Fault("curation", "observed response is not a final proposal") }
    check(decoded == value.proposal, "candidate differs from the actual observed proposal")
  }

  def validate(attempt: CurationAttempt, entries: List[CurationAuditRecord], limits: CurationGuardLimits): Unit = {
    claimShape(attempt.claim, limits)
    CurationJournal.validate(attempt.claim, entries, limits)
    val lateResponse = entries.lastOption.exists(entry => entry.stage == CurationAuditStage.ResponseObserved && !instant(entry.observedAt).isBefore(instant(attempt.claim.deadlineAt)))
    check(!lateResponse || !active(attempt.state), "late response requires a terminal attempt")
    attempt.inputManifest.foreach(manifest(attempt.claim, _, limits))
    check(entries.isEmpty || attempt.inputManifest.nonEmpty, "journal has no sealed input")
    attempt.inputManifest.foreach { input =>
      check(entries.headOption.forall(entry => !instant(entry.observedAt).isBefore(instant(input.sealedAt))), "journal precedes sealed input")
      entries.filter(_.stage == CurationAuditStage.RequestPrepared).foreach { entry =>
        val body = entry.payload.getOrElse(throw Fault("curation", "prepared request payload missing"))
        val json = io.circe.parser.parse(body.content).fold(_ => throw Fault("curation", "invalid prepared request JSON"), identity)
        check(json.noSpaces == body.content, "request audit is not canonical JSON")
        ontology.curation.CuratorRequest.verifyInput(json, input)
      }
    }
    attempt.candidate.foreach(candidate(attempt, entries, _))
    check(attempt.auditUncertain == CurationJournal.uncertain(entries), "attempt uncertainty differs from retained journal")
    val noTerminal = attempt.terminalCode.isEmpty && attempt.finishedAt.isEmpty
    attempt.state match {
      case CurationAttemptState.Claimed => check(attempt.inputManifest.isEmpty && entries.isEmpty && attempt.candidate.isEmpty && attempt.publication.isEmpty && noTerminal, "invalid Claimed state")
      case CurationAttemptState.InputSealed => check(attempt.inputManifest.nonEmpty && entries.isEmpty && attempt.candidate.isEmpty && attempt.publication.isEmpty && noTerminal, "invalid InputSealed state")
      case CurationAttemptState.Running => check(attempt.inputManifest.nonEmpty && entries.nonEmpty && attempt.publication.isEmpty && noTerminal, "invalid Running state")
      case CurationAttemptState.Published =>
        check(attempt.inputManifest.nonEmpty && attempt.candidate.nonEmpty && attempt.terminalCode.isEmpty && attempt.finishedAt.nonEmpty, "invalid Published state")
        val value = attempt.publication.getOrElse(throw Fault("curation", "publication receipt missing"))
        check(value.attemptId == attempt.claim.attemptId && value.scope == attempt.claim.scope && value.input == CurationIdentity.input(attempt.claim.scope, attempt.claim.attemptId) &&
          value.generation == Math.addExact(attempt.claim.baseGeneration, 1L) && value.frontier == attempt.claim.frontier &&
          value.coveredFrontier == attempt.claim.frontier && attempt.finishedAt.contains(value.recordedAt) &&
          instant(value.recordedAt).isBefore(instant(attempt.claim.deadlineAt)), "invalid publication receipt")
      case CurationAttemptState.Failed | CurationAttemptState.Stale | CurationAttemptState.Interrupted =>
        check(attempt.publication.isEmpty && attempt.finishedAt.nonEmpty && attempt.terminalCode.exists(_.matches("[a-z][a-z0-9-]*")), "invalid terminal attempt")
        attempt.terminalCode.foreach(label(_, limits))
    }
    attempt.finishedAt.foreach { value =>
      val previous = entries.lastOption.map(_.observedAt).orElse(attempt.inputManifest.map(_.sealedAt)).getOrElse(attempt.claim.claimedAt)
      check(!instant(value).isBefore(instant(previous)), "attempt finish precedes retained evidence")
    }
  }

  def seal(attempt: CurationAttempt, entries: List[CurationAuditRecord], frozen: GraphSnapshot, sources: List[CapturedEvent],
           current: CoordinatorLease, now: Instant, limits: CurationGuardLimits): CurationAttempt = {
    validate(attempt, entries, limits)
    attempt.inputManifest match {
      case Some(existing) => CurationMaterial.verify(attempt.claim, frozen, sources, existing, limits); attempt
      case None =>
        check(attempt.state == CurationAttemptState.Claimed, "input seal requires Claimed state")
        lease(attempt.claim, current, now)
        beforeDeadline(attempt.claim, now)
        val material = CurationMaterial.seal(attempt.claim, frozen, sources, now, limits)
        val next = attempt.copy(state = CurationAttemptState.InputSealed, inputManifest = Some(material.manifest))
        validate(next, entries, limits)
        next
    }
  }

  def append(attempt: CurationAttempt, entries: List[CurationAuditRecord], ordinal: Int, stage: CurationAuditStage,
             requestDigest: String, body: Option[CurationAuditPayload], current: CoordinatorLease, now: Instant,
             limits: CurationGuardLimits): CurationAuditAppend = {
    validate(attempt, entries, limits)
    val entry = CurationAuditRecord(attempt.claim.attemptId, attempt.claim.scope, attempt.claim.fence, ordinal, stage, requestDigest, body, now.toString)
    if (CurationJournal.existing(entries, entry)) CurationAuditAppend(attempt, entries, true)
    else {
      check(Set(CurationAttemptState.InputSealed, CurationAttemptState.Running).contains(attempt.state), "audit append requires a sealed active attempt")
      lease(attempt.claim, current, now)
      if (stage != CurationAuditStage.ResponseObserved) beforeDeadline(attempt.claim, now)
      val changed = entries :+ entry
      CurationJournal.validate(attempt.claim, changed, limits)
      val running = attempt.copy(state = CurationAttemptState.Running, auditUncertain = CurationJournal.uncertain(changed))
      val next = if (stage == CurationAuditStage.ResponseObserved && !now.isBefore(instant(attempt.claim.deadlineAt)))
        running.copy(state = CurationAttemptState.Failed, terminalCode = Some("curation-expired"), finishedAt = Some(now.toString))
      else running
      validate(next, changed, limits)
      CurationAuditAppend(next, changed, false)
    }
  }

  def publication(attempt: CurationAttempt, entries: List[CurationAuditRecord], value: CurationCandidate, head: GraphSnapshot, sources: List[CapturedEvent],
                  current: CoordinatorLease, now: Instant, limits: CurationGuardLimits): CurationPublicationPlan = {
    validate(attempt, entries, limits)
    check(attempt.state == CurationAttemptState.Running, "publication requires Running state")
    lease(attempt.claim, current, now)
    beforeDeadline(attempt.claim, now)
    candidate(attempt, entries, value)
    check(!now.isBefore(instant(entries.last.observedAt)), "publication precedes retained evidence")
    check(attempt.candidate.forall(_ == value), "candidate already differs")
    Graph.validateCounters(head)
    Require(head.scope == attempt.claim.scope && head.generation == attempt.claim.baseGeneration && head.sourceFrontier == attempt.claim.frontier &&
      head.coveredFrontier == attempt.claim.previousCoveredFrontier && CurationMaterial.graphDigest(head) == attempt.claim.graphDigest,
      "curation-stale", "publication head differs from the frozen claim")
    CurationMaterial.verify(attempt.claim, head, sources, attempt.inputManifest.getOrElse(throw Fault("curation", "publication input seal missing")), limits)
    CurationPublicationPlan(Math.addExact(head.generation, 1L), head.sourceFrontier, head.sourceFrontier)
  }

  def terminate(attempt: CurationAttempt, entries: List[CurationAuditRecord], state: CurationAttemptState, code: String,
                now: Instant, limits: CurationGuardLimits): CurationAttempt = {
    validate(attempt, entries, limits)
    check(active(attempt.state) && Set(CurationAttemptState.Failed, CurationAttemptState.Stale, CurationAttemptState.Interrupted).contains(state), "invalid terminal transition")
    val result = attempt.copy(state = state, terminalCode = Some(code), auditUncertain = CurationJournal.uncertain(entries), finishedAt = Some(now.toString))
    validate(result, entries, limits)
    result
  }
}
