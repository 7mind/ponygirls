package ontology

import ontology.api.*
import ontology.domain.*

private[ontology] final class CurationValidation(engine: AdmissionEngine) {
  def attempt(evidence: CurationEvidence, view: CurationAttemptView): CurationAttemptView = {
    val claim = view.attempt.claim
    val limits = CurationGuardLimits.retained(claim)
    val before = evidence.history(claim.scope, claim.baseGeneration)
    val sources = evidence.sources(before, claim.previousCoveredFrontier)
    try {
      CurationGuards.validate(view.attempt, view.journal, limits)
      CurationMaterial.frozen(claim, before, sources)
      view.attempt.inputManifest.foreach(CurationMaterial.verify(claim, before, sources, _, limits))
    } catch { case _: Fault => throw Fault("corrupt", "invalid retained curation attempt") }
    if (view.attempt.state == CurationAttemptState.Published) {
      val after = evidence.history(claim.scope, Math.addExact(claim.baseGeneration, 1L))
      val receipt = evidence.input(claim.scope, CurationIdentity.input(claim.scope, claim.attemptId))
      val request = ApplyRequest(claim.scope, claim.attemptId, claim.baseGeneration, view.attempt.candidate.get.proposal.operations, None)
      CurationIntegrity.validate(view, before, after, sources, receipt, evidence.reviewEvidence(before, request), engine, limits)
    }
    view
  }
  private def input(record: GraphRecord): Option[java.util.UUID] = record match {
    case GraphRecord.Node(v) => Some(v.provenance.input)
    case GraphRecord.Edge(v) => Some(v.provenance.input)
    case GraphRecord.Contract(v) => Some(v.provenance.input)
    case GraphRecord.Progress(v) => Some(v.provenance.input)
    case GraphRecord.Selection(v) => Some(v.provenance.input)
    case GraphRecord.Person(_) | GraphRecord.Input(_) => None
  }
  def graph(evidence: CurationEvidence, value: GraphSnapshot): GraphSnapshot = {
    val publications = evidence.publications(value.scope, value.generation).map(attempt(evidence, _))
    val allRecords = Graph.records(value)
    val records = allRecords.toSet
    publications.foreach { view =>
      val receipt = view.attempt.publication.getOrElse(throw Fault("corrupt", "publication receipt missing"))
      val published = evidence.history(value.scope, receipt.generation)
      if (value.generation == receipt.generation) Require(value == published, "corrupt", "publication head differs from its retained revision")
      val expected = Graph.records(published).filter(record => input(record).contains(receipt.input.id))
      val actual = allRecords.filter(record => input(record).contains(receipt.input.id))
      Require(actual.size == expected.size && actual.toSet == expected.toSet, "corrupt", "curation record inventory differs from its publication")
      Require(receipt.generation <= value.generation && receipt.frontier <= value.sourceFrontier && Graph.records(published).forall(records.contains),
        "corrupt", "snapshot changed a retained publication record")
    }
    val covered = publications.lastOption.flatMap(_.attempt.publication).fold(0L)(_.coveredFrontier)
    Require(covered == value.coveredFrontier, "corrupt", "snapshot coverage differs from its publication cut")
    value
  }
}
