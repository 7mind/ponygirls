package ontology.domain

import ontology.api.*
import ontology.{Digests, StoredJson}
import ontology.curation.CurationInputs

object CurationReceipts {
  private def check(value: Boolean): Unit = Require(value, "corrupt", "invalid curation receipt correspondence")
  def context(receipt: InputReceipt): ContextRecord = {
    val input = StoredJson.decode(CurationPublicationInput.codecJson, receipt.content)
    val claim = input.claim; val manifest = input.manifest; val proposal = input.proposal
    check(receipt.kind == InputKind.Curation && receipt.encoding == CurationIdentity.Encoding && receipt.digest == Digests.text(receipt.content))
    check(claim.scope.trim.nonEmpty && receipt.scope == claim.scope && claim.baseGeneration >= 0 && claim.baseGeneration < Long.MaxValue &&
      claim.previousCoveredFrontier >= 0 && claim.frontier > claim.previousCoveredFrontier && claim.fence.epoch > 0 && claim.profileId.trim.nonEmpty)
    check(receipt.ref == CurationIdentity.input(claim.scope, claim.attemptId) && receipt.generation == claim.baseGeneration + 1L && receipt.recordedAt == input.publishedAt)
    check(receipt.contributor.kind == ActorKind.Agent && receipt.recorder.kind == ActorKind.Service && receipt.submitter.kind == ActorKind.Service &&
      receipt.ingress.transport == RequestTransport.Internal && receipt.ingress.operation == CurationIdentity.Operation)
    val claimed = CurationChecks.instant(claim.claimedAt)
    val sealedAt = CurationChecks.instant(manifest.sealedAt)
    val published = CurationChecks.instant(input.publishedAt)
    check(!sealedAt.isBefore(claimed) && !published.isBefore(sealedAt))
    List(claim.profileDigest, claim.schemaDigest, claim.graphDigest, claim.sourceCutDigest, manifest.inputDigest,
      input.responseDigest, input.proposalDigest).foreach(CurationChecks.digest)
    check(manifest.attemptId == claim.attemptId && manifest.encoding == CurationInputs.Encoding && manifest.inputBytes > 0 &&
      manifest.seed.map(_.ref).distinct.size == manifest.seed.size && manifest.sources.map(_.ref).distinct.size == manifest.sources.size &&
      manifest.sources.size.toLong == claim.frontier - claim.previousCoveredFrontier)
    manifest.seed.foreach { pin => check(pin.ref.revision > 0); CurationChecks.digest(pin.digest) }
    manifest.sources.zipWithIndex.foreach { case (pin, index) =>
      check(pin.ref.revision == 1 && pin.frontier == claim.previousCoveredFrontier + index.toLong + 1L)
      CurationChecks.digest(pin.digest)
    }
    check(input.responseOrdinal > 0 && proposal.expectedGeneration == claim.baseGeneration && proposal.frontier == claim.frontier &&
      input.proposalDigest == Digests.text(StoredJson.encode(CurationProposal.codecJson, proposal)))
    val expected = Contexts.server(receipt.ingress, Contexts.ProtocolLimits)
    check(receipt.contributionContext == expected)
    expected
  }
}
