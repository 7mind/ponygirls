package ontology

import java.time.Instant
import java.util.UUID
import ontology.api.*
import ontology.domain.*

private[ontology] final class CapsuleLoading(tx: CapsuleTransaction, principal: Principal, settings: CapsuleStoreSettings,
                                           reads: CurationReadModel, validation: CurationValidation) {
  private var cuts = Set.empty[ContextSnapshotKey]
  private var snapshots = Map.empty[ContextSnapshotKey, GraphSnapshot]
  private def reserve(key: ContextSnapshotKey): Unit = {
    if (!cuts.contains(key)) {
      Require(cuts.size < settings.maxMaterialSnapshots, "capacity", "capsule material-cut budget exceeded")
      cuts += key
    }
  }
  private def remember(graph: GraphSnapshot): GraphSnapshot = {
    val key = ContextSnapshotKey(graph.scope, graph.generation)
    reserve(key)
    Require(snapshots.get(key).forall(_ == graph), "corrupt", "immutable material cut changed during observation")
    snapshots += key -> graph
    graph
  }
  private def snapshot(key: ContextSnapshotKey): GraphSnapshot = {
    principal.require(key.scope, Capability.Read)
    reserve(key)
    snapshots.getOrElse(key, {
      val graph = if (key.generation == 0L) Graph.empty(key.scope) else tx.curation.history(key.scope, key.generation)
      Require(graph.scope == key.scope && graph.generation == key.generation, "corrupt", "material snapshot identity differs")
      remember(validation.graph(tx.curation, graph))
    })
  }
  def chain(scope: String, first: Option[UUID], reservedSlots: Int): List[CapsuleRow] = {
    principal.require(scope, Capability.Read)
    Require(reservedSlots >= 0 && reservedSlots <= settings.maxBaselineChain, "capacity", "capsule ancestry budget exceeded")
    var visited = Set.empty[UUID]
    var rows = List.empty[CapsuleRow]
    var next = first
    while (next.nonEmpty) {
      val id = next.get
      Require(!visited.contains(id), "corrupt", "capsule baseline cycle")
      Require(rows.size < settings.maxBaselineChain - reservedSlots, "capacity", "capsule ancestry budget exceeded")
      val row = tx.capsule(scope, id).getOrElse(throw Fault(if (rows.isEmpty) "not-found" else "corrupt", "capsule baseline missing"))
      Require(row.value.id == id && row.value.payload.scope == scope, "corrupt", "capsule row lookup differs")
      Require(row.value.owner == principal.actor, "forbidden", "capsule belongs to another authenticated actor")
      CapsuleRows.capsule(row)
      visited += id
      rows = row :: rows
      next = row.value.payload.previousCapsuleId
    }
    rows
  }
  def contexts(rows: List[CapsuleRow], additional: List[ContextRecord]): List[GraphSnapshot] = {
    val reported = rows.map(_.value.payload.reportedContext) ++ additional
    val keys = ContextAccess.requiredSnapshots(principal, reported)
    val values = keys.map(snapshot)
    ContextAccess.validate(reported, values)
    values
  }
  def cut(scope: String, value: CapsuleCut, at: Instant): GraphSnapshot = {
    principal.require(scope, Capability.Read)
    reserve(ContextSnapshotKey(scope, value.generation))
    remember(reads.retainedCut(tx.curation, scope, value, at))
  }
  def current(scope: String): CurationCurrent = {
    principal.require(scope, Capability.Read)
    val value = reads.current(tx.curation, scope)
    remember(value.snapshot)
    value
  }
  def material(graph: GraphSnapshot, cut: CapsuleCut, workContext: String, previous: Option[CapsuleBaseline], limits: CapsuleLimits,
               contexts: List[GraphSnapshot]): CapsuleMaterial = {
    val pending = tx.curation.sources(graph, graph.coveredFrontier)
    val blueprint = CapsuleProjection.blueprint(graph, workContext, pending, previous, limits)
    val inputs = CapsuleSelection.provenanceRefs(blueprint.plan.records).map(tx.curation.input(graph.scope, _))
    val reviews = tx.reviewEvidence(graph, CapsuleSelection.reviewClaims(blueprint.plan.records))
    CapsuleMaterial(graph, cut, pending, inputs, reviews, contexts)
  }
  def baseline(rows: List[CapsuleRow], contexts: List[GraphSnapshot]): Option[CapsuleBaseline] = rows.foldLeft(Option.empty[CapsuleBaseline]) { (previous, row) =>
    val value = row.value
    val graph = cut(value.payload.scope, value.payload.cut, CapsuleRows.time(value.preparedAt))
    val source = material(graph, value.payload.cut, value.payload.workContext, previous, value.limits, contexts)
    Some(CapsuleBaseline.validated(value, source, previous))
  }
}
