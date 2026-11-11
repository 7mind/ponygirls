package ontology.domain

import ontology.api.*

final case class CapsuleChangeSet(changes: List[CapsuleChange], qualifications: List[CapsuleQualification]) {
  def references: List[Ref] = (changes.flatMap(c => c.previous.toList ++ c.current.toList ++ List(c.account) ++ c.basis ++ c.humanBasis) ++
    qualifications.flatMap(_.subjects)).distinct.sortBy(CapsuleSelection.order)
}
object CapsuleChanges {
  private def key(value: CapsuleAccountKey): String = value match {
    case CapsuleAccountKey.Definition(id) => "definition:" + id
    case CapsuleAccountKey.Relation(id) => "relation:" + id
    case CapsuleAccountKey.Selection(id) => "selection:" + id
    case CapsuleAccountKey.Progress(ref) => "progress:" + ref.id + ":" + ref.revision
  }
  def compare(graph: GraphSnapshot, workContext: String, current: CapsulePlan, previous: CapsulePlan): CapsuleChangeSet = {
    val before = previous.roots.map(root => root.key -> root.ref).toMap
    val after = current.roots.map(root => root.key -> root.ref).toMap
    val index = Graph.records(graph).map(r => Graph.recordRef(r) -> r).toMap
    def remaining(account: CapsuleAccountKey): Option[Ref] = account match {
      case CapsuleAccountKey.Definition(id) => Graph.definitions(graph).find(_.ref.id == id).map(_.ref)
      case CapsuleAccountKey.Relation(id) => Graph.relations(graph).find(_.ref.id == id).map(_.ref)
      case CapsuleAccountKey.Selection(id) => Selections.latest(graph).find(s => {
        val b = Graph.binding(graph, s.binding); b.workContext == workContext && b.definition.id == id
      }).map(_.ref)
      case CapsuleAccountKey.Progress(binding) => Graph.latestEvent(graph, binding).map(_.ref)
    }
    var changes = List.empty[CapsuleChange]
    var qualifications = List.empty[CapsuleQualification]
    (before.keySet ++ after.keySet).toList.sortBy(key).foreach { account =>
      val old = before.get(account)
      val now = after.get(account).orElse(if (old.nonEmpty) remaining(account) else None)
      old.foreach(ref => Require(index.contains(ref), "corrupt", "capsule baseline record was not retained"))
      if (old != now) now match {
        case Some(ref) =>
          val record = index.getOrElse(ref, throw Fault("corrupt", "change account is not retained"))
          val reason = record match {
            case GraphRecord.Node(v) => v.changeReason
            case GraphRecord.Edge(v) => Some(v.why)
            case GraphRecord.Selection(v) => Some(v.reason)
            case GraphRecord.Progress(v) => v.resolution
            case _ => None
          }
          if (old.nonEmpty && reason.forall(_.trim.isEmpty)) qualifications :+= CapsuleQualification(CapsuleQualificationCode.UnresolvedChange, List(ref))
          changes :+= CapsuleChange(old, now, ref, reason, CapsuleAttribution.evidence(record), Nil)
        case None => qualifications :+= CapsuleQualification(CapsuleQualificationCode.UnresolvedChange, old.toList)
      }
    }
    CapsuleChangeSet(changes, qualifications)
  }
}
