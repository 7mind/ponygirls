package ontology.domain

import java.util.UUID
import ontology.api.*

enum CapsuleAccountKey {
  case Definition(id: UUID)
  case Relation(id: UUID)
  case Selection(definition: UUID)
  case Progress(binding: Ref)
}
final case class CapsuleRoot(key: CapsuleAccountKey, ref: Ref, partition: CapsulePartition)
final case class CapsulePlan(roots: List[CapsuleRoot], records: List[GraphRecord], selected: Set[Ref], historical: Set[Ref], currentBindings: Set[Ref])

object CapsuleSelection {
  def order(ref: Ref): (String, Long) = (ref.id.toString, ref.revision)
  def intent(value: Definition): Boolean = value.content.isInstanceOf[Content.Outcome] || value.content.isInstanceOf[Content.Constraint]
  def provenanceRefs(records: List[GraphRecord]): List[Ref] = records.flatMap(RecordLinks.provenance).map(p => Ref(p.input, 1)).distinct.sortBy(order)
  def reviewClaims(records: List[GraphRecord]): List[AdoptionClaim] = records.collect {
    case GraphRecord.Edge(r) if Set(RelationKind.Adopts, RelationKind.Chooses).contains(r.kind) => r.detail match {
      case value: RelationDetail.Adoption => AdoptionClaim(value.presentationId, value.response)
      case _ => throw Fault("corrupt", "adoption record has no retained linkage")
    }
  }.distinct

  def plan(graph: GraphSnapshot, workContext: String, pending: List[CapturedEvent], extra: List[Ref], limits: CapsuleLimits): CapsulePlan = {
    Graph.validateCounters(graph)
    Require(workContext.trim.nonEmpty && limits.maxRecords > 0, "capsule", "work context and positive capsule bound required")
    val all = Graph.records(graph)
    Require(all.map(Graph.recordRef).distinct.size == all.size, "corrupt", "duplicate exact graph identity")
    val index = all.map(value => Graph.recordRef(value) -> value).toMap
    def get(ref: Ref): GraphRecord = index.getOrElse(ref, throw Fault("corrupt", "capsule reference is not retained in its scope"))
    Require(pending.size.toLong == graph.sourceFrontier - graph.coveredFrontier && pending.map(_.id).distinct.size == pending.size, "corrupt", "incomplete pending source interval")
    pending.zipWithIndex.foreach { case (event, i) =>
      Require(event.scope == graph.scope && event.frontier == graph.coveredFrontier + i.toLong + 1L, "corrupt", "pending source interval mismatch")
      val node = Graph.node(graph, Ref(event.id, 1))
      node.content match {
        case source: Content.Source => Require(node.provenance == event.provenance && source.text == event.text && source.descriptor ==
          SourceDescriptor.PrimaryCapture(event.id, event.sourceNamespace, event.context, event.metadata, event.origin, event.observation, event.reviewResponse), "corrupt", "pending Source differs from activity")
        case _ => throw Fault("corrupt", "pending activity has no Source")
      }
    }
    val selections = Selections.latest(graph).filter(s => Graph.binding(graph, s.binding).workContext == workContext)
    val chosen = selections.filter(_.selected).map(_.binding).toSet
    val retired = selections.filterNot(_.selected).map(_.binding).toSet
    var roots = Graph.definitions(graph).filter(intent).map(d => CapsuleRoot(CapsuleAccountKey.Definition(d.ref.id), d.ref, CapsulePartition.UnresolvedScopeContext))
    selections.foreach { selection =>
      val binding = Graph.binding(graph, selection.binding)
      roots :+= CapsuleRoot(CapsuleAccountKey.Selection(binding.definition.id), selection.ref, CapsulePartition.SelectedWorkContext)
      if (selection.selected) {
        val head = Graph.definitions(graph).find(_.ref.id == binding.definition.id).getOrElse(throw Fault("corrupt", "selected definition missing"))
        roots = roots.filterNot(_.key == CapsuleAccountKey.Definition(head.ref.id)) :+
          CapsuleRoot(CapsuleAccountKey.Definition(head.ref.id), head.ref, if (head.ref == binding.definition) CapsulePartition.SelectedWorkContext else CapsulePartition.UnresolvedScopeContext)
        Graph.context(graph, head.ref, Some(workContext)).foreach(ref => roots :+= CapsuleRoot(CapsuleAccountKey.Relation(ref.id), ref, CapsulePartition.SelectedWorkContext))
      }
      Graph.latestEvent(graph, binding.ref).foreach(e => roots :+= CapsuleRoot(CapsuleAccountKey.Progress(binding.ref), e.ref,
        if (selection.selected) CapsulePartition.SelectedWorkContext else CapsulePartition.HistoricalContext))
    }
    roots = roots.distinct.sortBy(root => order(root.ref))
    Require(roots.map(_.key).distinct.size == roots.size, "corrupt", "ambiguous capsule root key")
    val selected = chosen ++ roots.filter(_.partition == CapsulePartition.SelectedWorkContext).map(_.ref)
    var historical = retired ++ roots.filter(_.partition == CapsulePartition.HistoricalContext).map(_.ref)
    val currentRelations = Graph.relations(graph)
    var inspect = chosen
    var pendingBindings = chosen.toList.sortBy(order)
    var semantic = Map.empty[Ref, List[Ref]]
    while (pendingBindings.nonEmpty) {
      val ref = pendingBindings.head; pendingBindings = pendingBindings.tail
      val b = Graph.binding(graph, ref)
      val head = Graph.definitions(graph).find(_.ref.id == b.definition.id).getOrElse(throw Fault("corrupt", "binding definition missing"))
      val governing = (b.context ++ Graph.context(graph, head.ref, Some(b.workContext))).distinct
      var related = head.ref :: governing ++ Graph.latestEvent(graph, ref).toList.map(_.ref) ++ Selections.current(graph, b).toList.map(_.ref)
      governing.flatMap(r => graph.relations.find(_.ref == r)).foreach { r =>
        val currentTargets = r.kind match {
          case RelationKind.Requires => r.targets
          case RelationKind.DependsOn => r.detail match {
            case d: RelationDetail.Dependency if d.consumption == Consumption.Current => r.targets
            case d: RelationDetail.Dependency => historical ++= r.targets ++ d.event.toList; Nil
            case _ => throw Fault("corrupt", "dependency detail missing")
          }
          case _ => Nil
        }
        currentTargets.foreach { target =>
          Graph.binding(graph, target)
          if (!inspect.contains(target)) {
            inspect += target; pendingBindings :+= target
            Require(inspect.size <= limits.maxRecords, "capacity", "capsule binding closure exceeds capacity")
          }
        }
        if (r.kind == RelationKind.Requires) {
          val assessments = currentRelations.filter(edge => edge.kind == RelationKind.Assesses && edge.targets.exists(r.targets.contains))
          related ++= assessments.map(_.ref)
          related ++= assessments.flatMap(_.sources).map(ref => Graph.definitions(graph).find(_.ref.id == ref.id)
            .getOrElse(throw Fault("corrupt", "assessment account head missing")).ref)
          related ++= currentRelations.filter { edge => edge.kind == RelationKind.UsesAssessment && edge.targets.contains(b.ref) && (edge.detail match {
            case use: RelationDetail.AssessmentUse => use.requirement == r.ref
            case _ => throw Fault("corrupt", "assessment-use detail missing")
          }) }.map(_.ref)
        }
      }
      semantic += ref -> related.distinct
    }
    var pendingRefs = (roots.map(_.ref) ++ chosen ++ retired ++ pending.map(e => Ref(e.id, 1)) ++ extra).distinct.sortBy(order)
    var seen = Set.empty[Ref]
    var result = List.empty[GraphRecord]
    while (pendingRefs.nonEmpty) {
      val ref = pendingRefs.head; pendingRefs = pendingRefs.tail
      if (!seen.contains(ref)) {
        Require(seen.size < limits.maxRecords, "capacity", "complete capsule closure exceeds capacity")
        val record = get(ref)
        Require(RecordLinks.scope(record).forall(_ == graph.scope), "corrupt", "capsule record scope mismatch")
        seen += ref; result :+= record
        val attribution = RecordLinks.provenance(record).toList.flatMap(p => List(p.contributor, p.recorder)).distinct.flatMap { actor =>
          val matches = graph.actors.filter(_.value == actor)
          Require(matches.size <= 1, "corrupt", "ambiguous actor record")
          matches.map(_.ref)
        }
        val incoming = currentRelations.filter(r => CapsuleAttribution.LineageKinds.contains(r.kind) && r.targets.contains(ref)).map(_.ref)
        val next = RecordLinks.references(record) ++ semantic.getOrElse(ref, Nil) ++ incoming ++ attribution
        pendingRefs ++= next.filterNot(seen).distinct.sortBy(order)
      }
    }
    CapsulePlan(roots, result.sortBy(r => order(Graph.recordRef(r))), selected, historical, inspect)
  }
}
