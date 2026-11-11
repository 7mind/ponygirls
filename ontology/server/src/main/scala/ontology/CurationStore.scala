package ontology

import cats.effect.IO
import java.time.Instant
import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final class CurationStore(transactions: CurationTransactions, readTransactions: CurationReadTransactions, settings: CurationStoreSettings, engine: AdmissionEngine) extends CurationRepository {
  private val validation = new CurationValidation(engine)
  private val reads = new CurationReadModel(validation)
  private def configured(scope: String): Unit = Require(settings.scopes.contains(scope), "forbidden", "scope is not configured for curation")
  private def time(value: String): Instant = try Instant.parse(value) catch { case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid coordinator timestamp") }
  private def state(tx: CurationTransaction): CoordinatorState = CoordinatorLeases.validate(tx.coordinator)
  private def live(tx: CurationTransaction, fence: CoordinatorFence, now: Instant): CoordinatorLease = CoordinatorLeases.live(tx.coordinator, fence, now)
  private def owned(tx: CurationTransaction, scope: String, fence: CoordinatorFence): (CoordinatorLease, Instant) = {
    configured(scope); tx.lock(scope)
    val now = tx.now
    (live(tx, fence, now), now)
  }
  def acquire(ownerId: UUID): IO[CoordinatorLease] = transactions.run { tx =>
    val previous = state(tx); val now = tx.now
    previous.lease match {
      case Some(value) if now.isBefore(time(value.expiresAt)) =>
        Require(value.fence.ownerId == ownerId && !now.isBefore(time(value.renewedAt)), "coordinator", "coordinator is held or clock regressed")
        value
      case _ =>
        val epoch = Math.addExact(previous.epoch, 1L)
        val value = CoordinatorLease(CoordinatorFence(ownerId, epoch), now.toString, now.toString, now.plus(settings.leaseDuration).toString)
        tx.saveCoordinator(CoordinatorState(epoch, Some(value)))
        value
    }
  }
  def renew(fence: CoordinatorFence): IO[CoordinatorLease] = transactions.run { tx =>
    val now = tx.now; val before = live(tx, fence, now)
    val next = before.copy(renewedAt = now.toString, expiresAt = now.plus(settings.leaseDuration).toString)
    tx.saveCoordinator(CoordinatorState(fence.epoch, Some(next)))
    next
  }
  def release(fence: CoordinatorFence): IO[Unit] = transactions.run { tx =>
    val previous = state(tx)
    Require(previous.epoch == fence.epoch && previous.lease.forall(_.fence == fence), "coordinator", "release fence differs")
    tx.saveCoordinator(CoordinatorState(previous.epoch, None))
  }
  private def validate(tx: CurationTransaction, view: CurationAttemptView): CurationAttemptView = validation.attempt(tx, view)
  private def view(tx: CurationTransaction, scope: String, id: UUID): CurationAttemptView =
    validate(tx, tx.find(scope, id).getOrElse(throw Fault("not-found", "curation attempt not found")))
  private[ontology] def validateInput(receipt: InputReceipt): IO[Unit] = transactions.run { tx =>
    tx.lock(receipt.scope)
    val input = StoredJson.decode(CurationPublicationInput.codecJson, receipt.content)
    val value = view(tx, receipt.scope, input.claim.attemptId)
    Require(value.attempt.state == CurationAttemptState.Published && value.attempt.publication.exists(_.input == receipt.ref) &&
      tx.input(receipt.scope, receipt.ref) == receipt, "corrupt", "curation input is not the retained publication")
  }
  private def sameFence(value: CurationAttemptView, fence: CoordinatorFence): Unit =
    Require(value.attempt.claim.fence == fence, "coordinator", "attempt belongs to a different fence")
  private def latest(tx: CurationTransaction, scope: String, publishedOnly: Boolean): Option[CurationAttemptView] = tx.latest(scope, publishedOnly).map(validate(tx, _))
  private def summary(view: CurationAttemptView): CurationAttemptSummary = reads.summary(view)
  private def current(tx: CurationTransaction, scope: String): CurationStatus = reads.current(tx, scope).status
  def status(principal: Principal, scope: String): IO[CurationStatus] = IO.defer {
    principal.require(scope, Capability.Read)
    readTransactions.run(scope)(read => reads.current(read, scope).status)
  }
  def inspect(principal: Principal, scope: String, attemptId: UUID): IO[CurationAttemptView] = IO.defer {
    principal.require(scope, Capability.Read)
    transactions.run { tx => tx.lock(scope); view(tx, scope, attemptId) }
  }
  def frozen(principal: Principal, scope: String, attemptId: UUID): IO[CurationFrozenView] = IO.defer {
    principal.require(scope, Capability.Read)
    transactions.run { tx =>
      tx.lock(scope)
      val attempt = view(tx, scope, attemptId).attempt
      val manifest = attempt.inputManifest.getOrElse(throw Fault("curation", "attempt has no sealed input"))
      val graph = tx.history(scope, attempt.claim.baseGeneration)
      val sources = tx.sources(graph, attempt.claim.previousCoveredFrontier)
      CurationMaterial.verify(attempt.claim, graph, sources, manifest, CurationGuardLimits.retained(attempt.claim))
      CurationFrozenView(attempt.claim, graph, CurationMaterial.seal(attempt.claim, graph, sources, time(manifest.sealedAt), CurationGuardLimits.retained(attempt.claim)))
    }
  }
  private def bounded(limit: Int, capacity: Int): Unit = Require(limit > 0 && limit <= capacity && limit < Int.MaxValue, "limit", "invalid curation batch limit")
  def eligibleScopes(fence: CoordinatorFence, limit: Int): IO[CurationScopeBatch] = transactions.run { tx =>
    bounded(limit, settings.maxScanScopes)
    live(tx, fence, tx.now)
    val found = settings.scopes.toList.sorted.iterator.filter { scope =>
      tx.lock(scope)
      live(tx, fence, tx.now)
      val last = latest(tx, scope, false)
      CurationGuards.eligible(tx.head(scope), last.map(_.attempt.claim.frontier), last.exists(v => CurationGuards.active(v.attempt.state)))
    }.take(limit + 1).toList
    CurationScopeBatch(found.take(limit), found.size > limit)
  }
  def recoverOlderFences(fence: CoordinatorFence, limit: Int): IO[CurationRecoveryBatch] = transactions.run { tx =>
    bounded(limit, settings.maxRecoveryAttempts)
    live(tx, fence, tx.now)
    val found = tx.olderActive(settings.scopes, fence, limit + 1)
    val recovered = found.take(limit).map { initial =>
      val scope = initial.attempt.claim.scope
      val (_, now) = owned(tx, scope, fence)
      val value = view(tx, scope, initial.attempt.claim.attemptId)
      Require(value.attempt.claim.fence.epoch < fence.epoch && CurationGuards.active(value.attempt.state), "corrupt", "recovery candidate is not an older active fence")
      val stopped = CurationGuards.terminate(value.attempt, value.journal, CurationAttemptState.Interrupted, "owner-replaced", now, CurationGuardLimits.retained(value.attempt.claim))
      tx.saveAttempt(stopped, false)
      summary(CurationAttemptView(stopped, value.journal))
    }
    CurationRecoveryBatch(recovered, found.size > limit)
  }
  def claim(fence: CoordinatorFence, scope: String, attemptId: UUID, profile: CurationProfilePin): IO[CurationClaimResult] = transactions.run { tx =>
    val (lease, now) = owned(tx, scope, fence)
    tx.find(scope, attemptId) match {
      case Some(found) =>
        val existing = validate(tx, found)
        sameFence(existing, fence)
        Require(existing.attempt.claim.profileId == profile.id && existing.attempt.claim.profileDigest == profile.profileDigest &&
          existing.attempt.claim.schemaDigest == profile.schemaDigest, "replay-conflict", "claim ID has a different profile")
        CurationClaimResult.Replayed(existing.attempt)
      case None =>
        Require(!tx.containsAttempt(attemptId), "identity", "curation attempt identity already exists")
        val graph = tx.head(scope); val last = latest(tx, scope, false)
        val maximum = last.map(_.attempt.claim.frontier)
        val active = last.exists(v => CurationGuards.active(v.attempt.state))
        if (!CurationGuards.eligible(graph, maximum, active)) CurationClaimResult.Ineligible(current(tx, scope))
        else {
          val sources = tx.sources(graph, graph.coveredFrontier)
          val claim = CurationClaim(attemptId, scope, fence, graph.generation, graph.sourceFrontier, graph.coveredFrontier, settings.guards.toWire,
            profile.id, profile.profileDigest, profile.schemaDigest, CurationMaterial.graphDigest(graph), CurationMaterial.sourceDigest(sources), now.toString, now.plus(settings.attemptDuration).toString)
          CurationGuards.claim(claim, graph, sources, maximum, active, lease, now, settings.guards)
          val attempt = CurationAttempt(claim, CurationAttemptState.Claimed, None, None, None, None, false, None)
          tx.saveAttempt(attempt, true)
          CurationClaimResult.Claimed(attempt)
        }
    }
  }
  private def terminal(tx: CurationTransaction, value: CurationAttemptView, state: CurationAttemptState, code: String, now: Instant): CurationWriteResult = {
    val stopped = CurationGuards.terminate(value.attempt, value.journal, state, code, now, CurationGuardLimits.retained(value.attempt.claim))
    tx.saveAttempt(stopped, false)
    CurationWriteResult.Terminal(stopped)
  }
  private def rejection[A](tx: CurationTransaction, value: CurationAttemptView, now: Instant)(body: => A): Either[CurationWriteResult, A] =
    try Right(body) catch {
      case fault: Fault if !Set("corrupt", "database", "config", "forbidden", "replay-conflict", "coordinator").contains(fault.code) =>
        Left(terminal(tx, value, if (fault.code == "curation-stale") CurationAttemptState.Stale else CurationAttemptState.Failed, fault.code, now))
    }
  private def currentHead(claim: CurationClaim, graph: GraphSnapshot): Unit = Require(graph.scope == claim.scope && graph.generation == claim.baseGeneration &&
    graph.sourceFrontier == claim.frontier && graph.coveredFrontier == claim.previousCoveredFrontier && CurationMaterial.graphDigest(graph) == claim.graphDigest,
    "curation-stale", "curation head changed")
  def seal(fence: CoordinatorFence, scope: String, attemptId: UUID): IO[CurationWriteResult] = transactions.run { tx =>
    configured(scope); tx.lock(scope)
    val value = view(tx, scope, attemptId); sameFence(value, fence)
    if (!CurationGuards.active(value.attempt.state)) CurationWriteResult.Terminal(value.attempt)
    else if (value.attempt.inputManifest.nonEmpty) CurationWriteResult.Advanced(value.attempt, true)
    else {
      val now = tx.now; val lease = live(tx, fence, now)
      val graph = tx.history(scope, value.attempt.claim.baseGeneration)
      val sources = tx.sources(graph, value.attempt.claim.previousCoveredFrontier)
      rejection(tx, value, now)(CurationGuards.seal(value.attempt, value.journal, graph, sources, lease, now, CurationGuardLimits.retained(value.attempt.claim))).fold(identity, next => {
        tx.saveAttempt(next, false)
        CurationWriteResult.Advanced(next, false)
      })
    }
  }
  def appendAudit(fence: CoordinatorFence, scope: String, attemptId: UUID, ordinal: Int, stage: CurationAuditStage,
                  requestDigest: String, payload: Option[CurationAuditPayload]): IO[CurationWriteResult] = transactions.run { tx =>
    configured(scope); tx.lock(scope)
    val value = view(tx, scope, attemptId); sameFence(value, fence)
    val now = tx.now
    val entry = CurationAuditRecord(attemptId, scope, fence, ordinal, stage, requestDigest, payload, now.toString)
    if (CurationJournal.existing(value.journal, entry)) CurationWriteResult.Advanced(value.attempt, true)
    else if (!CurationGuards.active(value.attempt.state)) CurationWriteResult.Terminal(value.attempt)
    else {
      val lease = live(tx, fence, now)
      val head = tx.head(scope)
      rejection(tx, value, now) {
        if (stage != CurationAuditStage.ResponseObserved) currentHead(value.attempt.claim, head)
        CurationGuards.append(value.attempt, value.journal, ordinal, stage, requestDigest, payload, lease, now, CurationGuardLimits.retained(value.attempt.claim))
      }.fold(identity, next => {
        Require(!next.replayed && next.entries.last == entry, "invariant", "new audit append did not produce the requested entry")
        tx.append(entry)
        tx.saveAttempt(next.attempt, false)
        if (CurationGuards.active(next.attempt.state)) CurationWriteResult.Advanced(next.attempt, false)
        else CurationWriteResult.Terminal(next.attempt)
      })
    }
  }
  def publish(fence: CoordinatorFence, scope: String, attemptId: UUID, candidate: CurationCandidate, hostRequestId: UUID): IO[CurationWriteResult] = transactions.run { tx =>
    configured(scope); tx.lock(scope)
    val value = view(tx, scope, attemptId); sameFence(value, fence)
    if (value.attempt.state == CurationAttemptState.Published) {
      Require(value.attempt.candidate.contains(candidate), "replay-conflict", "published candidate differs")
      CurationWriteResult.Published(value.attempt.publication.get, true)
    } else if (!CurationGuards.active(value.attempt.state)) CurationWriteResult.Terminal(value.attempt)
    else {
      val now = tx.now; val lease = live(tx, fence, now)
      val before = tx.head(scope)
      val sourceGraph = tx.history(scope, value.attempt.claim.baseGeneration)
      val sources = tx.sources(sourceGraph, value.attempt.claim.previousCoveredFrontier)
      val request = ApplyRequest(scope, attemptId, value.attempt.claim.baseGeneration, candidate.proposal.operations, None)
      rejection(tx, value, now) {
        currentHead(value.attempt.claim, before)
        new CurationPublisher(engine, CurationGuardLimits.retained(value.attempt.claim)).publish(before, value.attempt, value.journal, candidate, sources, lease, settings.principal, settings.service, settings.service,
          RequestTrace(hostRequestId, CurationIdentity.Operation, RequestTransport.Internal), now, tx.reviewEvidence(before, request))
      }.fold(identity, result => {
        tx.savePublication(before, result)
        CurationWriteResult.Published(result.publication, false)
      })
    }
  }
  def stop(fence: CoordinatorFence, scope: String, attemptId: UUID, reason: CurationStop): IO[CurationWriteResult] = transactions.run { tx =>
    configured(scope); tx.lock(scope)
    val value = view(tx, scope, attemptId); sameFence(value, fence)
    val (state, code) = reason match {
      case CurationStop.Failed(code) => (CurationAttemptState.Failed, code)
      case CurationStop.Interrupted(code) => (CurationAttemptState.Interrupted, code)
    }
    if (!CurationGuards.active(value.attempt.state)) {
      Require(value.attempt.state == state && value.attempt.terminalCode.contains(code), "replay-conflict", "terminal outcome differs")
      CurationWriteResult.Terminal(value.attempt)
    } else {
      val now = tx.now
      live(tx, fence, now)
      terminal(tx, value, state, code, now)
    }
  }
}


