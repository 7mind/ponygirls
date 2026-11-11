package ontology.domain

import ontology.api.*

object CapsuleAttribution {
  val LineageKinds: Set[RelationKind] = Set(RelationKind.Quotes, RelationKind.Interprets, RelationKind.Infers, RelationKind.Assumes,
    RelationKind.Supports, RelationKind.Challenges, RelationKind.Adopts, RelationKind.Chooses, RelationKind.Answers)
  private def applicability(value: Applicability): List[Ref] = value match {
    case v: Applicability.Unresolved => v.basis
    case v: Applicability.Declared => v.basis
    case _: Applicability.Captured => Nil
  }
  def evidence(record: GraphRecord): List[Ref] = (record match {
    case GraphRecord.Node(v) => v.basis ++ applicability(v.applicability) ++ (v.content match { case r: Content.Review => r.basis; case _ => Nil })
    case GraphRecord.Edge(v) => applicability(v.applicability) ++ (if (LineageKinds.contains(v.kind)) v.sources else Nil) ++ (v.detail match {
      case a: RelationDetail.Adoption => List(a.response)
      case a: RelationDetail.AssessmentUse => a.requirement :: a.basis
      case d: RelationDetail.Dependency => d.event.toList
      case _ => Nil
    })
    case GraphRecord.Contract(v) => v.definition :: v.context
    case GraphRecord.Progress(v) => v.evidence ++ v.gateBasis.references
    case GraphRecord.Selection(v) => v.binding :: v.basis
    case GraphRecord.Input(_) | GraphRecord.Person(_) => Nil
  }).distinct.sortBy(CapsuleSelection.order)
  def humanInput(value: InputReceipt): Boolean = {
    InputReceipts.validateContext(value)
    value.contributor.kind == ActorKind.Human && value.submitter == value.contributor &&
      value.ingress.transport != RequestTransport.Internal && Set(InputKind.GraphMutation, InputKind.Capture, InputKind.Judgment).contains(value.kind)
  }
  def humanBasis(start: Ref, records: List[GraphRecord]): List[Ref] = {
    val index = records.map(r => Graph.recordRef(r) -> r).toMap
    var pending = List(start)
    var visited = Set.empty[Ref]
    var humans = Set.empty[Ref]
    while (pending.nonEmpty) {
      val ref = pending.head; pending = pending.tail
      if (!visited.contains(ref)) {
        visited += ref
        val record = index.getOrElse(ref, throw Fault("corrupt", "capsule basis reference missing"))
        record match {
          case GraphRecord.Input(v) if humanInput(v) => humans += ref
          case _ => ()
        }
        val incoming = records.collect { case GraphRecord.Edge(edge) if LineageKinds.contains(edge.kind) && edge.targets.contains(ref) => edge.ref }
        val inputs = RecordLinks.provenance(record).toList.map(p => Ref(p.input, 1))
        pending ++= (evidence(record) ++ incoming ++ inputs).filterNot(visited).distinct
      }
    }
    humans.toList.sortBy(CapsuleSelection.order)
  }
  def roles(record: GraphRecord, records: List[GraphRecord], humanInputs: Set[Ref]): List[CapsuleRole] = {
    val base = record match {
      case GraphRecord.Node(v) => v.content match {
        case _: Content.Outcome | _: Content.Constraint => List(CapsuleRole.IntentAccount)
        case source: Content.Source => source.descriptor match {
          case _: SourceDescriptor.PrimaryCapture => List(CapsuleRole.Observation, CapsuleRole.SourceBasis)
          case _: SourceDescriptor.DerivedPresentation => List(CapsuleRole.DerivedAccount, CapsuleRole.SourceBasis)
        }
        case _: Content.Artifact => List(CapsuleRole.Artifact)
        case _ => List(CapsuleRole.RecordAccount)
      }
      case GraphRecord.Edge(_) => List(CapsuleRole.Relation)
      case GraphRecord.Contract(_) => List(CapsuleRole.Binding)
      case GraphRecord.Progress(_) => List(CapsuleRole.Progress)
      case GraphRecord.Selection(_) => List(CapsuleRole.Selection)
      case GraphRecord.Input(_) | GraphRecord.Person(_) => List(CapsuleRole.Attribution)
    }
    val declaredDerived = records.exists {
      case GraphRecord.Edge(edge) => Set(RelationKind.Quotes, RelationKind.Interprets, RelationKind.Infers, RelationKind.Assumes).contains(edge.kind) && edge.targets.contains(Graph.recordRef(record))
      case _ => false
    }
    (base ++ (if (declaredDerived) List(CapsuleRole.DerivedAccount) else Nil) ++ (if (humanInputs.contains(Graph.recordRef(record))) List(CapsuleRole.HumanBasisAccount) else Nil)).distinct.sortBy(_.toString)
  }
}
