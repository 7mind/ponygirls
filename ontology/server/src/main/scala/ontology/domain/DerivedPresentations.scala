package ontology.domain

import ontology.api.*
import ontology.{Digests, ReviewCall, Wire}
import java.nio.charset.StandardCharsets.UTF_8

final case class DerivedPublication(source: Definition, receipt: InputReceipt, fresh: Boolean)

private[domain] object DerivedPresentations {
  private val Encoding = "ontology.api.PresentationPublication/0.1.0 canonical JSON"
  private val Qualification = "Retained offered content; not a primary occurrence, Human mandate or execution permission"
  def inputRef(presentation: Presentation): Ref = Ref(InputReceipts.id(InputKind.PresentationPublication, presentation.payload.scope, presentation.id), 1)
  private def command(presentation: Presentation): String = Wire.encode(PresentationPublication.codecJson,
    PresentationPublication(presentation.id, presentation.reservedSourceRef, presentation.payloadDigest)).noSpaces
  private def definition(presentation: Presentation, provenance: Provenance): Definition = {
    val payload = presentation.payload
    val context = payload.records.map(Graph.recordRef)
    val content = Content.Source(new String(PresentationEngine.canonical(payload), UTF_8), context, presentation.payloadDigest,
      SourceDescriptor.DerivedPresentation(presentation.id, payload.generation, presentation.payloadDigest, presentation.createdAt, presentation.preparationTrace))
    Definition(presentation.reservedSourceRef, payload.scope, Applicability.Unresolved(Qualification, payload.sourceRefs, Nil), content,
      Standing.Active, payload.sourceRefs, None, provenance)
  }
  def resolve(graph: GraphSnapshot, presentation: Presentation, existingReceipt: Option[InputReceipt], call: ReviewCall, service: Actor, recordedAt: String): DerivedPublication = {
    val existing = Graph.records(graph).filter(record => Graph.recordRef(record).id == presentation.reservedSourceRef.id)
    val ref = inputRef(presentation)
    (existing, existingReceipt) match {
      case (Nil, None) =>
        val receipt = InputReceipts.create(ref.id, graph.scope, Math.addExact(graph.generation, 1L), InputKind.PresentationPublication,
          service, service, call.principal.actor, Encoding, command(presentation), recordedAt, Contexts.server(call.ingress, Contexts.ProtocolLimits), call.ingress)
        val source = definition(presentation, Provenance(service, service, receipt.ref.id, recordedAt))
        DerivedPublication(source, receipt, true)
      case (List(GraphRecord.Node(source)), Some(receipt)) =>
        InputReceipts.validateContext(receipt)
        Require(receipt.ref == ref && receipt.scope == graph.scope && receipt.kind == InputKind.PresentationPublication &&
          receipt.generation > presentation.payload.generation && receipt.generation <= graph.generation &&
          receipt.encoding == Encoding && receipt.content == command(presentation) && receipt.digest == Digests.text(receipt.content) &&
          receipt.submitter == presentation.owner && receipt.contributor.kind == ActorKind.Service && receipt.recorder.kind == ActorKind.Service &&
          receipt.ingress.transport == RequestTransport.Cookie, "corrupt", "retained presentation publication receipt mismatch")
        val expected = definition(presentation, Provenance(receipt.contributor, receipt.recorder, receipt.ref.id, receipt.recordedAt))
        Require(source == expected, "corrupt", "retained derived presentation differs from its publication")
        DerivedPublication(source, receipt, false)
      case _ => throw Fault("corrupt", "derived presentation source and publication receipt disagree")
    }
  }
}
