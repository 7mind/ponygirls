package ontology.domain

import ontology.api.*
import ontology.{Digests, ReviewCall, Wire}
import java.util.UUID

final case class ReviewEvidence(presentation: Presentation, judgment: Judgment, event: CapturedEvent, receipt: InputReceipt, publication: InputReceipt)

final class ReviewDomain(limits: ReviewLimits) {
  private val judgments = new JudgmentEngine(limits)
  def authorize(call: ReviewCall, scope: String): Unit = {
    Require(call.scope == scope, "forbidden", "review scope mismatch")
    call.principal.require(scope, Capability.Read)
    call.principal.require(scope, Capability.Review)
    Require(call.principal.actor.kind == ActorKind.Human && call.ingress.transport == RequestTransport.Cookie, "forbidden", "Human cookie review required")
  }
  def prepare(graph: GraphSnapshot, request: PresentRequest, call: ReviewCall, id: UUID, at: String): Presentation =
    PresentationEngine.prepare(graph, request, call, id, at, limits.presentation)
  def validatePresentation(presentation: Presentation): Unit = PresentationEngine.validateRetained(presentation, limits.presentation)
  def publicationInput(presentation: Presentation): Ref = judgments.publicationInput(presentation)
  def publish(graph: GraphSnapshot, presentation: Presentation, request: JudgmentRequest, call: ReviewCall,
              service: Actor, at: String, publication: Option[InputReceipt]): Judged = judgments(graph, presentation, request, call, service, at, publication)

  def validateEvidence(graph: GraphSnapshot, evidence: ReviewEvidence): Unit = try {
    val p = evidence.presentation; val j = evidence.judgment; val event = evidence.event; val receipt = evidence.receipt
    PresentationEngine.validateSelection(p, j.action, limits.presentation)
    val request = JudgmentRequest(j.scope, j.requestId, j.presentationId, j.action, j.rationale)
    val canonical = Wire.encode(JudgmentRequest.codecJson, request).noSpaces
    InputReceipts.validateContext(receipt)
    Require(j.scope == graph.scope && p.payload.scope == graph.scope && j.presentationId == p.id && j.actor == p.owner &&
      j.actor.kind == ActorKind.Human && j.id == ReviewIdentity.judgment(graph.scope, j.actor, j.requestId) &&
      j.source == ReviewIdentity.source(graph.scope, j.actor, j.requestId) && j.presentationSource == p.reservedSourceRef &&
      j.input == ReviewIdentity.input(event.sourceNamespace, j.requestId), "corrupt", "judgment identity mismatch")
    Require(receipt.ref == j.input && receipt.scope == graph.scope && receipt.kind == InputKind.Judgment &&
      receipt.generation > p.payload.generation && receipt.generation <= graph.generation && receipt.contributor == j.actor &&
      receipt.submitter == j.actor && receipt.recorder.kind == ActorKind.Service && receipt.recordedAt == j.recordedAt &&
      receipt.encoding == ReviewRecords.JudgmentEncoding && receipt.content == canonical && receipt.digest == Digests.text(canonical),
      "corrupt", "judgment input correspondence mismatch")
    val provenance = Provenance(j.actor, receipt.recorder, receipt.ref.id, j.recordedAt)
    Require(event.scope == graph.scope && Ref(event.id, 1) == j.source && event.frontier > 0 && event.frontier <= graph.sourceFrontier &&
      event.context == Contexts.server(receipt.ingress, Contexts.ProtocolLimits) && event.origin == EventOrigin.UserMessage &&
      event.metadata == ReviewRecords.metadata(j.id, p.id) && event.text == canonical && event.observation == Observation.None() &&
      event.reviewResponse.contains(ReviewResponseLink(p.id, j.id, p.reservedSourceRef, p.payloadDigest)) && event.provenance == provenance,
      "corrupt", "judgment primary event correspondence mismatch")
    Require(p.payload.records.forall(Graph.records(graph).contains), "corrupt", "presentation records differ from retained graph")
    SourceIntegrity.source(graph, ReviewRecords.source(event, p))
    DerivedPresentations.validate(graph, p, evidence.publication)
    val stored = graph.relations.filter(_.ref.id == ReviewIdentity.relation(graph.scope, j.actor, j.requestId).id)
    Require(stored == ReviewRecords.relation(j, provenance).toList, "corrupt", "captured action relation mismatch")
  } catch { case _: Fault => throw Fault("corrupt", "invalid retained review evidence") }
}
