package ontology.domain

import ontology.api.*
import ontology.Digests

final case class CapsuleMaterial(snapshot: GraphSnapshot, cut: CapsuleCut, pending: List[CapturedEvent], inputs: List[InputReceipt], reviews: List[ReviewEvidence], contextSnapshots: List[GraphSnapshot])
final class CapsuleBaseline private (val capsule: Capsule, val snapshot: GraphSnapshot, val pending: List[CapturedEvent])
object CapsuleBaseline {
  def validated(capsule: Capsule, material: CapsuleMaterial, previous: Option[CapsuleBaseline]): CapsuleBaseline = {
    CapsuleProjection.validate(capsule, material, previous)
    new CapsuleBaseline(capsule, material.snapshot, material.pending)
  }
}

object CapsuleRecords {
  def attach(material: CapsuleMaterial, plan: CapsulePlan, limits: CapsuleLimits): List[GraphRecord] = {
    val graph = material.snapshot
    Require(material.cut.generation == graph.generation && material.cut.frontier == graph.sourceFrontier && material.cut.coveredFrontier == graph.coveredFrontier &&
      material.cut.lastPublicationGeneration.forall(g => g > 0 && g <= graph.generation) && (material.cut.lastPublicationGeneration.nonEmpty || graph.coveredFrontier == 0L), "corrupt", "capsule cut differs from snapshot")
    val wanted = CapsuleSelection.provenanceRefs(plan.records)
    Require(material.inputs.map(_.ref).distinct.size == material.inputs.size, "corrupt", "duplicate capsule input identity")
    val inputs = material.inputs.map(value => value.ref -> value).toMap
    val receipts = wanted.map { ref =>
      val value = inputs.getOrElse(ref, throw Fault("corrupt", "capsule provenance input missing"))
      Require(value.ref == ref && value.scope == graph.scope && value.generation > 0 && value.generation <= graph.generation && value.digest == Digests.text(value.content),
        "corrupt", "capsule provenance input differs from cut")
      InputReceipts.validateContext(value)
      value
    }
    plan.records.flatMap(RecordLinks.provenance).foreach { provenance =>
      val receipt = inputs.getOrElse(Ref(provenance.input, 1), throw Fault("corrupt", "record attribution input missing"))
      Require(provenance == Provenance(receipt.contributor, receipt.recorder, receipt.ref.id, receipt.recordedAt), "corrupt", "record attribution differs from input receipt")
    }
    val records = plan.records ++ receipts.map(GraphRecord.Input(_))
    Require(records.map(Graph.recordRef).distinct.size == records.size, "corrupt", "capsule record identities collide")
    Require(records.size <= limits.maxRecords, "capacity", "complete capsule evidence exceeds record capacity")
    records.sortBy(r => CapsuleSelection.order(Graph.recordRef(r)))
  }
  def structure(material: CapsuleMaterial, records: List[GraphRecord]): Unit = {
    val graph = material.snapshot
    records.foreach { record =>
      Require(RecordLinks.scope(record).forall(_ == graph.scope), "corrupt", "capsule record scope mismatch")
      RecordLinks.references(record).foreach(ref => Require(Graph.exists(graph, ref), "corrupt", "capsule graph reference missing"))
      record match {
        case GraphRecord.Node(v) => Graph.validateContent(graph, v.content); Applicabilities.validate(graph, v.applicability, true)
        case GraphRecord.Edge(v) => Applicabilities.validate(graph, v.applicability, true); RelationValidation.retained(graph, v, material.reviews)
        case GraphRecord.Contract(v) =>
          Graph.node(graph, v.definition)
          Require(v.workContext.trim.nonEmpty && v.context.distinct == v.context, "corrupt", "invalid binding structure")
        case GraphRecord.Progress(v) =>
          Graph.binding(graph, v.subject)
          v.previous.foreach(ref => Require(Graph.event(graph, ref).subject == v.subject, "corrupt", "progress predecessor belongs to another binding"))
          v.gateBasis.selectionWitnesses.foreach(ref => Require(graph.selections.exists(_.ref == ref), "corrupt", "gate witness is not a selection"))
        case GraphRecord.Selection(v) =>
          Graph.binding(graph, v.binding)
          Require(v.reason.trim.nonEmpty && v.basis.nonEmpty && v.basis.distinct == v.basis, "corrupt", "invalid selection structure")
        case GraphRecord.Input(v) => InputReceipts.validateContext(v)
        case GraphRecord.Person(_) => ()
      }
    }
  }
  def bindingCurrent(graph: GraphSnapshot, binding: Binding): Boolean = try {
    Graph.validateSelectedBinding(graph, binding); true
  } catch { case f: Fault if Set("stale-context", "missing-context", "unselected-context").contains(f.code) => false }
  def warrantCurrent(graph: GraphSnapshot, event: StateEvent): Boolean = try {
    Gates.validateEvent(graph, event); true
  } catch { case f: Fault if Set("stale-context", "missing-context", "unselected-context", "stale-warrant", "prerequisite", "condition", "assessment-use").contains(f.code) => false }
}
