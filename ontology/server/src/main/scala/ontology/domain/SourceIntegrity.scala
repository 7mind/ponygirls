package ontology.domain

import ontology.api.*
import ontology.{Digests, StoredJson}

object SourceIntegrity {
  def capture(event: CapturedEvent, receipt: InputReceipt, generation: Long): Definition = {
    InputReceipts.validateContext(receipt)
    Require(receipt.kind == InputKind.Capture && receipt.scope == event.scope && receipt.ref.revision == 1 &&
      receipt.ref.id == event.provenance.input && receipt.generation > 0 && receipt.generation <= generation &&
      receipt.digest == Digests.text(receipt.content), "corrupt", "capture input receipt identity mismatch")
    val input = StoredJson.decode(IngestRequest.codecJson, receipt.content)
    Require(input.scope == event.scope && CaptureIdentity.event(event.sourceNamespace, input.eventId) == event.id &&
      InputReceipts.id(InputKind.Capture, event.sourceNamespace, input.requestId) == receipt.ref.id &&
      CaptureIdentity.fingerprint(event, input.eventId) == CaptureIdentity.fingerprint(event.sourceNamespace, input) && event.reviewResponse.isEmpty,
      "corrupt", "capture differs from retained input")
    val contributor = if (receipt.submitter.kind == ActorKind.Collector) Actor("unattributed:" + event.id, ActorKind.Unknown) else receipt.submitter
    Require(receipt.contributor == contributor && event.provenance == Provenance(receipt.contributor, receipt.recorder, receipt.ref.id, receipt.recordedAt),
      "corrupt", "capture attribution differs from retained input")
    CaptureIdentity.definition(event)
  }

  def source(graph: GraphSnapshot, expected: Definition): Unit = {
    Require(expected.scope == graph.scope && graph.definitions.filter(_.ref.id == expected.ref.id) == List(expected),
      "corrupt", "graph Source differs from its retained primary record")
  }

  def linkedInput(graph: GraphSnapshot, receipt: InputReceipt): Unit = {
    val linked = graph.definitions.filter(node => node.provenance.input == receipt.ref.id).collect {
      case node if node.content.isInstanceOf[Content.Source] => node.content.asInstanceOf[Content.Source].descriptor
    }
    val expected = receipt.kind match {
      case InputKind.Capture | InputKind.Judgment | InputKind.GraphMutation => linked.count(_.isInstanceOf[SourceDescriptor.PrimaryCapture])
      case InputKind.PresentationPublication => linked.count(_.isInstanceOf[SourceDescriptor.DerivedPresentation])
      case _ => 1
    }
    Require(expected == 1, "corrupt", "input receipt has no unique corresponding Source")
  }

  def frontier(graph: GraphSnapshot, events: List[CapturedEvent]): Unit = {
    Graph.validateCounters(graph)
    Require(events.size.toLong == graph.sourceFrontier && events.map(_.id).distinct.size == events.size &&
      events.zipWithIndex.forall { case (event, index) => event.scope == graph.scope && event.frontier == index.toLong + 1L },
      "corrupt", "snapshot has an incomplete primary frontier")
    val primary = graph.definitions.count(_.content match {
      case value: Content.Source => value.descriptor.isInstanceOf[SourceDescriptor.PrimaryCapture]
      case _ => false
    })
    Require(primary == events.size, "corrupt", "snapshot primary Source inventory differs from its frontier")
    val derived = graph.definitions.collect { case value if (value.content match {
      case source: Content.Source => source.descriptor.isInstanceOf[SourceDescriptor.DerivedPresentation]
      case _ => false
    }) => value.ref }
    val linked = events.flatMap(_.reviewResponse.map(_.presentationSource)).distinct
    Require(derived.distinct == derived && derived.toSet == linked.toSet, "corrupt", "derived presentation Source inventory differs from linked activity")
  }
}
