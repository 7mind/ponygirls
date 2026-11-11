package ontology.domain

import ontology.{Digests, Principal, StoredJson}
import ontology.api.*

object GraphCommandIntegrity {
  private def kind(operation: Operation, record: GraphRecord): Boolean = (operation, record) match {
    case (_: Operation.Create | _: Operation.Revise, _: GraphRecord.Node) => true
    case (_: Operation.Relate | _: Operation.ReviseRelation, _: GraphRecord.Edge) => true
    case (_: Operation.Bind, _: GraphRecord.Contract) => true
    case (_: Operation.SelectBinding, _: GraphRecord.Selection) => true
    case (_: Operation.State, _: GraphRecord.Progress) => true
    case _ => false
  }
  def validate(graph: GraphSnapshot, event: CapturedEvent, result: ApplyResult, receipt: InputReceipt,
               before: GraphSnapshot, evidence: List[ReviewEvidence], engine: AdmissionEngine): Unit = try {
    InputReceipts.validateContext(receipt)
    Require(receipt.kind == InputKind.GraphMutation && receipt.scope == graph.scope && receipt.scope == event.scope &&
      receipt.contributor == receipt.submitter && receipt.recorder.kind == ActorKind.Service &&
      receipt.generation > 0 && receipt.generation <= graph.generation && receipt.digest == Digests.text(receipt.content) &&
      receipt.encoding == GraphCommandIdentity.Encoding, "corrupt", "invalid command receipt")
    val request = StoredJson.decode(ApplyRequest.codecJson, receipt.content)
    Require(request.scope == graph.scope && request.operations.nonEmpty && request.expectedGeneration >= 0 && request.expectedGeneration < Long.MaxValue &&
      receipt.ref == Ref(InputReceipts.graphId(receipt.contributor, request.requestId), 1) && receipt.generation == request.expectedGeneration + 1L,
      "corrupt", "command request identity or generation differs")
    Require(result == ApplyResult(request.scope, request.requestId, receipt.generation, GraphCommandIdentity.created(request), false),
      "corrupt", "command result differs from retained request")
    Require(event.frontier > 0 && event.frontier <= graph.sourceFrontier && event == GraphCommandIdentity.event(request, receipt, event.frontier),
      "corrupt", "command event differs from retained request")
    val records = Graph.records(graph)
    request.operations.zip(result.created).foreach { case (operation, created) =>
      val matches = records.filter(record => Graph.recordRef(record) == created.ref)
      Require(matches.size == 1 && matches.forall(record => kind(operation, record) && RecordLinks.provenance(record).contains(event.provenance)),
        "corrupt", "command result has no exact attributed record")
    }
    SourceIntegrity.source(graph, GraphCommandIdentity.definition(event, result))
    SourceIntegrity.linkedInput(graph, receipt)
    Require(before.scope == graph.scope && before.generation == request.expectedGeneration &&
      before.sourceFrontier < Long.MaxValue && before.sourceFrontier + 1L == event.frontier, "corrupt", "command base cut differs")
    // Reconstruct recorded content, not historical credentials or fresh mutation authority.
    val principal = Principal("retained-command", receipt.contributor, Set(graph.scope), Set(Capability.Read, Capability.Mutate))
    val admission = Admission(principal, receipt.recorder, request.requestId, receipt.recordedAt, receipt.ingress, evidence)
    val expected = GraphCommandIdentity.append(engine(before, request, admission), event)
    def inventory(snapshot: GraphSnapshot): List[GraphRecord] = Graph.records(snapshot)
      .filter(record => RecordLinks.provenance(record).exists(_.input == receipt.ref.id))
      .sortBy(record => (Graph.recordRef(record).id.toString, Graph.recordRef(record).revision))
    Require(inventory(graph) == inventory(expected), "corrupt", "command output inventory differs from retained request")
    val retained = records.groupBy(Graph.recordRef)
    Require(Graph.records(expected).groupBy(Graph.recordRef).forall { case (ref, values) => retained.get(ref).contains(values) },
      "corrupt", "command publication records were removed duplicated or changed")
    if (graph.generation == receipt.generation) Require(graph == expected, "corrupt", "command publication snapshot differs")
  } catch { case _: Fault => throw Fault("corrupt", "invalid retained command correspondence") }
}
