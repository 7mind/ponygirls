package ontology.domain

import ontology.api.*
import ontology.{Digests, ReviewCall, Wire}
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.UUID

final case class ReviewLimits(presentation: PresentationLimits, maxRationaleBytes: Int, maxRequestBytes: Int) {
  Require(maxRationaleBytes > 0 && maxRequestBytes > 0, "config", "positive review limits required")
}
final case class Judged(snapshot: GraphSnapshot, event: CapturedEvent, judgment: Judgment, receipt: InputReceipt,
                        publicationReceipt: Option[InputReceipt], relation: Option[Relation])

final class JudgmentEngine(limits: ReviewLimits) {
  private val Encoding = "ontology.api.JudgmentRequest/0.1.0 canonical JSON"
  def publicationInput(presentation: Presentation): Ref = DerivedPresentations.inputRef(presentation)
  def apply(base: GraphSnapshot, presentation: Presentation, request: JudgmentRequest, call: ReviewCall,
            service: Actor, recordedAt: String, existingPublication: Option[InputReceipt]): Judged = {
    Graph.validateCounters(base)
    Require(request.scope == base.scope && presentation.payload.scope == request.scope && presentation.id == request.presentationId,
      "presentation", "judgment scope/presentation mismatch")
    Require(presentation.payload.generation <= base.generation, "presentation", "presentation is newer than the publication base")
    PresentationEngine.validateAction(presentation, request.action, call, limits.presentation)
    Require(service.kind == ActorKind.Service, "config", "service publication identity required")
    Require(request.rationale.trim.nonEmpty && request.rationale.getBytes(UTF_8).length <= limits.maxRationaleBytes, "judgment", "nonempty bounded rationale required")
    val text = Wire.encode(JudgmentRequest.codecJson, request).noSpaces
    Require(text.getBytes(UTF_8).length <= limits.maxRequestBytes, "judgment", "judgment request exceeds its bound")
    try Instant.parse(recordedAt)
    catch { case _: DateTimeParseException => throw Fault("judgment", "invalid judgment timestamp") }
    Contexts.server(call.ingress, Contexts.ProtocolLimits)
    val retained = Graph.records(base)
    Require(presentation.payload.records.forall(retained.contains), "corrupt", "presentation differs from exact retained graph records")
    val actor = call.principal.actor
    val sourceRef = ReviewIdentity.source(request.scope, actor, request.requestId)
    val inputRef = ReviewIdentity.input(call.principal.credentialId, request.requestId)
    val judgmentId = ReviewIdentity.judgment(request.scope, actor, request.requestId)
    Require(!retained.exists(record => Graph.recordRef(record).id == sourceRef.id), "identity", "action source identity already exists")
    val derived = DerivedPresentations.resolve(base, presentation, existingPublication, call, service, recordedAt)
    val generation = Math.addExact(base.generation, 1L)
    val frontier = Math.addExact(base.sourceFrontier, 1L)
    val provenance = Provenance(actor, service, inputRef.id, recordedAt)
    val context = Contexts.server(call.ingress, Contexts.ProtocolLimits)
    val metadata = CaptureMetadata(judgmentId.toString, Some(presentation.id.toString), None, SourceRepresentation.HumanJudgment, Nil, Nil)
    val link = ReviewResponseLink(presentation.id, judgmentId, presentation.reservedSourceRef, presentation.payloadDigest)
    val event = CapturedEvent(sourceRef.id, base.scope, call.principal.credentialId, frontier, context,
      EventOrigin.UserMessage, metadata, text, Observation.None(), Some(link), provenance)
    val source = Definition(sourceRef, base.scope, Applicability.Captured(sourceRef), Content.Source(text,
      (presentation.reservedSourceRef :: presentation.payload.targets).distinct, Digests.text(text),
      SourceDescriptor.PrimaryCapture(sourceRef.id, event.sourceNamespace, context, metadata, event.origin, event.observation, event.reviewResponse)),
      Standing.Active, List(presentation.reservedSourceRef), None, provenance)
    val receipt = InputReceipts.create(inputRef.id, base.scope, generation, InputKind.Judgment, actor, service, actor,
      Encoding, text, recordedAt, context, call.ingress)
    val judgment = Judgment(judgmentId, base.scope, request.requestId, presentation.id, request.action,
      request.rationale, actor, recordedAt, sourceRef, presentation.reservedSourceRef, inputRef)
    complete(base, derived, source, receipt, event, judgment, generation, frontier)
  }

  private def complete(base: GraphSnapshot, derived: DerivedPublication, source: Definition, receipt: InputReceipt,
                       event: CapturedEvent, judgment: Judgment, generation: Long, frontier: Long): Judged = {
    val selected = judgment.action match {
      case _: ReviewAction.Review => None
      case value: ReviewAction.Choose => Some(RelationKind.Chooses -> value.selection)
      case value: ReviewAction.Adopt => Some(RelationKind.Adopts -> PresentedSelection.Whole(value.target))
    }
    val relation = selected.map { case (kind, selection) =>
      val ref = ReviewIdentity.relation(base.scope, judgment.actor, judgment.requestId)
      Require(!Graph.records(base).exists(record => Graph.recordRef(record).id == ref.id), "identity", "action relation identity already exists")
      val target = selection match {
        case value: PresentedSelection.Whole => value.target
        case value: PresentedSelection.Alternative => value.target
      }
      Relation(ref, base.scope, Applicability.Captured(source.ref), kind, List(source.ref), List(target),
        RelationDetail.Adoption(judgment.presentationId, AdoptionOrigin.CapturedAction, source.ref, selection),
        judgment.rationale, Standing.Active, source.provenance)
    }
    val actors = List(source.provenance.contributor, source.provenance.recorder).distinct
      .filterNot(actor => base.actors.exists(_.value == actor)).map(actor =>
        ActorRecord(Ref(UUID.nameUUIDFromBytes(("actor:" + actor.kind + ":" + actor.id).getBytes(UTF_8)), 1), actor))
    val graph = base.copy(generation = generation, sourceFrontier = frontier,
      definitions = base.definitions ++ (if (derived.fresh) List(derived.source) else Nil) :+ source,
      relations = base.relations ++ relation.toList, actors = base.actors ++ actors)
    List(derived.source, source).foreach { node =>
      Graph.validateContent(graph, node.content)
      Applicabilities.validate(graph, node.applicability, true)
    }
    relation.foreach { edge =>
      val target = edge.targets.head
      Require(graph.bindings.exists(_.ref == target) || graph.definitions.exists(node => node.ref == target && node.content.isInstanceOf[Content.Source]),
        "presentation", "captured action target is not a Source or Binding")
      Applicabilities.validate(graph, edge.applicability, true)
    }
    InputReceipts.validateContext(receipt)
    InputReceipts.validateContext(derived.receipt)
    Judged(graph, event, judgment, receipt, if (derived.fresh) Some(derived.receipt) else None, relation)
  }
}
