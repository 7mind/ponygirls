package ontology.domain

import java.time.Instant
import ontology.{Principal, StoredJson}
import ontology.api.*

final case class PublishedCuration(snapshot: GraphSnapshot, receipt: InputReceipt, attempt: CurationAttempt, publication: CurationPublicationReceipt)

final class CurationPublisher(engine: AdmissionEngine, limits: CurationGuardLimits) {
  def publish(base: GraphSnapshot, attempt: CurationAttempt, entries: List[CurationAuditRecord], candidate: CurationCandidate,
              sources: List[CapturedEvent], lease: CoordinatorLease, principal: Principal, recorder: Actor, submitter: Actor,
              ingress: RequestTrace, now: Instant, reviewEvidence: List[ReviewEvidence]): PublishedCuration = {
    val claim = attempt.claim
    val at = now.toString
    val request = ApplyRequest(claim.scope, claim.attemptId, claim.baseGeneration, candidate.proposal.operations, None)
    val admission = CurationAdmission(claim.scope, principal, recorder, submitter, claim.attemptId, at, ingress, reviewEvidence)
    admission.validateRequest(request)
    val plan = CurationGuards.publication(attempt, entries, candidate, base, sources, lease, now, limits)
    val manifest = attempt.inputManifest.getOrElse(throw Fault("curation", "publication input seal missing"))
    val changed = if (request.operations.isEmpty) base.copy(generation = plan.generation, coveredFrontier = plan.coveredFrontier)
      else engine(base, request, admission).snapshot.copy(coveredFrontier = plan.coveredFrontier)
    Graph.validateCounters(changed)
    Require(changed.scope == claim.scope && changed.generation == plan.generation && changed.sourceFrontier == plan.frontier &&
      changed.coveredFrontier == plan.coveredFrontier, "curation", "publication counters differ from admitted plan")
    val input = CurationPublicationInput(claim, manifest, candidate.responseOrdinal, candidate.responseDigest, candidate.proposal, candidate.proposalDigest, at)
    val inputRef = CurationIdentity.input(claim.scope, claim.attemptId)
    val receipt = InputReceipts.create(inputRef.id, claim.scope, changed.generation, InputKind.Curation, principal.actor, recorder, submitter,
      CurationIdentity.Encoding, StoredJson.encode(CurationPublicationInput.codecJson, input), at, Contexts.server(ingress, Contexts.ProtocolLimits), ingress)
    val publication = CurationPublicationReceipt(claim.attemptId, claim.scope, inputRef, changed.generation, changed.sourceFrontier, changed.coveredFrontier, at)
    val published = attempt.copy(state = CurationAttemptState.Published, candidate = Some(candidate), publication = Some(publication),
      terminalCode = None, auditUncertain = CurationJournal.uncertain(entries), finishedAt = Some(at))
    InputReceipts.validateContext(receipt)
    CurationGuards.validate(published, entries, limits)
    PublishedCuration(changed, receipt, published, publication)
  }
}
