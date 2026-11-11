package ontology.domain

import ontology.{CurationAttemptView, Principal, StoredJson}
import ontology.api.*

object CurationIntegrity {
  def validate(view: CurationAttemptView, before: GraphSnapshot, after: GraphSnapshot, sources: List[CapturedEvent],
               receipt: InputReceipt, evidence: List[ReviewEvidence], engine: AdmissionEngine, limits: CurationGuardLimits): Unit = try {
    CurationGuards.validate(view.attempt, view.journal, limits)
    val a = view.attempt; val c = a.claim
    val candidate = a.candidate.getOrElse(throw Fault("corrupt", "published candidate missing"))
    val manifest = a.inputManifest.getOrElse(throw Fault("corrupt", "published manifest missing"))
    val publication = a.publication.getOrElse(throw Fault("corrupt", "publication receipt missing"))
    Require(a.state == CurationAttemptState.Published, "corrupt", "published attempt required")
    InputReceipts.validateContext(receipt)
    val input = StoredJson.decode(CurationPublicationInput.codecJson, receipt.content)
    Require(input == CurationPublicationInput(c, manifest, candidate.responseOrdinal, candidate.responseDigest,
      candidate.proposal, candidate.proposalDigest, publication.recordedAt) && receipt.ref == publication.input && receipt.scope == publication.scope &&
      receipt.generation == publication.generation && receipt.recordedAt == publication.recordedAt, "corrupt", "publication input differs from attempt")
    CurationMaterial.verify(c, before, sources, manifest, limits)
    val request = ApplyRequest(c.scope, c.attemptId, c.baseGeneration, candidate.proposal.operations, None)
    // Reconstruct recorded content, not historical credentials or a fresh publication authority.
    val principal = Principal("retained-curation", receipt.contributor, Set(c.scope), Set(Capability.Read, Capability.Mutate))
    val admission = CurationAdmission(c.scope, principal, receipt.recorder, receipt.submitter, c.attemptId, receipt.recordedAt, receipt.ingress, evidence)
    admission.validateRequest(request)
    val expected = if (request.operations.isEmpty) before.copy(generation = publication.generation, coveredFrontier = c.frontier)
      else engine(before, request, admission).snapshot.copy(coveredFrontier = c.frontier)
    Require(after == expected && after.generation == publication.generation && after.sourceFrontier == publication.frontier &&
      after.coveredFrontier == publication.coveredFrontier, "corrupt", "published graph differs from retained proposal")
  } catch { case _: Fault => throw Fault("corrupt", "invalid retained curation publication") }
}
