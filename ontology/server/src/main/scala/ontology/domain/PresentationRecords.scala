package ontology.domain

import ontology.api.*

private[domain] object PresentationRecords {
  private def check(value: Boolean, message: String): Unit = Require(value, "presentation", message)
  private def selectionRefs(value: PresentedSelection): List[Ref] = value match {
    case v: PresentedSelection.Whole => List(v.target)
    case v: PresentedSelection.Alternative => List(v.target, v.definition)
  }
  private def contentRefs(value: Content): List[Ref] = value match {
    case v: Content.Outcome => v.acceptance.question.toList
    case _: Content.Constraint => Nil
    case v: Content.Task => v.acceptance.question.toList
    case _: Content.Statement => Nil
    case _: Content.Hypothesis => Nil
    case v: Content.Defect => v.affected
    case _: Content.Question => Nil
    case _: Content.Decision => Nil
    case v: Content.Review => v.subjects ++ v.basis
    case v: Content.Conflict => v.subjects
    case _: Content.Artifact => Nil
    case v: Content.Source =>
      val captured = v.descriptor match {
        case p: SourceDescriptor.PrimaryCapture =>
          val observation = p.observation match {
            case e: Observation.Execution => e.contract.toList ++ e.artifacts
            case _: Observation.None | _: Observation.FileVersion | _: Observation.FileAbsent => Nil
          }
          observation ++ p.reviewResponse.toList.map(_.presentationSource)
        case _: SourceDescriptor.DerivedPresentation => Nil
      }
      v.context ++ captured
  }
  private def detailRefs(value: RelationDetail): List[Ref] = value match {
    case _: RelationDetail.Empty => Nil
    case v: RelationDetail.Dependency => v.event.toList
    case _: RelationDetail.Decomposition => Nil
    case v: RelationDetail.Delegation => v.outcomes
    case v: RelationDetail.Adoption => v.response :: selectionRefs(v.selection)
    case v: RelationDetail.AssessmentUse => v.requirement :: v.basis
  }
  // Inheritance cuts name their own namespaces; input receipts are outside GraphSnapshot.
  def references(record: GraphRecord, scope: String): List[Ref] = {
    def scoped(actual: String, refs: List[Ref]): List[Ref] = {
      check(actual == scope, "record scope mismatch")
      refs
    }
    record match {
      case GraphRecord.Node(v) => scoped(v.scope, v.basis ++ Applicabilities.references(v.applicability) ++ contentRefs(v.content))
      case GraphRecord.Edge(v) => scoped(v.scope, v.sources ++ v.targets ++ detailRefs(v.detail) ++ Applicabilities.references(v.applicability))
      case GraphRecord.Contract(v) => scoped(v.scope, v.definition :: v.context)
      case GraphRecord.Progress(v) => scoped(v.scope, v.subject :: (v.previous.toList ++ v.evidence ++ v.gateBasis.references ++ v.gateBasis.selectionWitnesses))
      case GraphRecord.Selection(v) => scoped(v.scope, v.binding :: v.basis)
      case GraphRecord.Person(_) => Nil
      case GraphRecord.Input(_) => throw Fault("presentation", "input receipt bodies are outside GraphSnapshot")
    }
  }
  def lookup(records: List[GraphRecord]): Ref => GraphRecord = {
    val pairs = records.map(record => Graph.recordRef(record) -> record)
    check(pairs.map(_._1).distinct.size == pairs.size, "duplicate exact record identity")
    val index = pairs.toMap
    ref => index.getOrElse(ref, throw Fault("presentation", "missing exact presentation record"))
  }
  def manifest(targets: List[Ref], get: Ref => GraphRecord, reserved: Ref): PresentationManifest = {
    def alternatives(definition: Ref, target: Ref): List[PresentedSelection] = {
      val values = get(definition) match {
        case GraphRecord.Node(value) => value.content match {
          case question: Content.Question => question.alternatives
          case decision: Content.Decision => decision.alternatives
          case _ => Nil
        }
        case _ => throw Fault("presentation", "binding definition is not a definition record")
      }
      values.zipWithIndex.map { case (label, index) => PresentedSelection.Alternative(target, definition, index, label) }
    }
    val choices: List[PresentedSelection] = targets.flatMap { ref => get(ref) match {
      case GraphRecord.Contract(value) => PresentedSelection.Whole(ref) :: alternatives(value.definition, ref)
      case GraphRecord.Node(value) => value.content match {
        case _: Content.Source => List(PresentedSelection.Whole(ref))
        case _: Content.Question | _: Content.Decision => alternatives(value.ref, reserved)
        case _ => Nil
      }
      case _ => Nil
    } }
    PresentationManifest(choices, choices.collect { case value: PresentedSelection.Whole => value.target })
  }
  def sources(records: List[GraphRecord]): List[Ref] = records.collect {
    case GraphRecord.Node(value) if value.content.isInstanceOf[Content.Source] => value.ref
  }
}
