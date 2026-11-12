package ontology.domain

import ontology.api.*

object RecordLinks {
  def scope(record: GraphRecord): Option[String] = record match {
    case GraphRecord.Node(v) => Some(v.scope)
    case GraphRecord.Edge(v) => Some(v.scope)
    case GraphRecord.Contract(v) => Some(v.scope)
    case GraphRecord.Progress(v) => Some(v.scope)
    case GraphRecord.Selection(v) => Some(v.scope)
    case GraphRecord.Input(v) => Some(v.scope)
    case GraphRecord.Person(_) => None
  }
  def provenance(record: GraphRecord): Option[Provenance] = record match {
    case GraphRecord.Node(v) => Some(v.provenance)
    case GraphRecord.Edge(v) => Some(v.provenance)
    case GraphRecord.Contract(v) => Some(v.provenance)
    case GraphRecord.Progress(v) => Some(v.provenance)
    case GraphRecord.Selection(v) => Some(v.provenance)
    case GraphRecord.Person(_) | GraphRecord.Input(_) => None
  }
  private def selection(value: PresentedSelection): List[Ref] = value match {
    case v: PresentedSelection.Whole => List(v.target)
    case v: PresentedSelection.Alternative => List(v.target, v.definition)
  }
  private def content(value: Content): List[Ref] = value match {
    case v: Content.Outcome => v.acceptance.question.toList
    case v: Content.Task => v.acceptance.question.toList
    case v: Content.Defect => v.affected
    case v: Content.Review => v.subjects ++ v.basis
    case v: Content.Conflict => v.subjects
    case v: Content.Source =>
      val captured = v.descriptor match {
        case p: SourceDescriptor.PrimaryCapture =>
          val observation = p.observation match {
            case e: Observation.Execution => e.contract.toList ++ e.inputs ++ e.outputs
            case _: Observation.None | _: Observation.FileVersion | _: Observation.FileAbsent => Nil
          }
          observation ++ p.reviewResponse.toList.map(_.presentationSource)
        case _: SourceDescriptor.DerivedPresentation => Nil
      }
      v.context ++ captured
    case _: Content.Constraint | _: Content.Statement | _: Content.Hypothesis | _: Content.Question | _: Content.Decision | _: Content.Artifact => Nil
  }
  private def detail(value: RelationDetail): List[Ref] = value match {
    case v: RelationDetail.Dependency => v.event.toList
    case v: RelationDetail.Delegation => v.outcomes
    case v: RelationDetail.Adoption => v.response :: selection(v.selection)
    case v: RelationDetail.AssessmentUse => v.requirement :: v.basis
    case _: RelationDetail.Empty | _: RelationDetail.Decomposition | _: RelationDetail.PlanRequirement => Nil
  }
  // Inherited cuts carry their own namespace; serialized receipt bodies are not graph-local edges.
  def references(record: GraphRecord): List[Ref] = record match {
    case GraphRecord.Node(v) => v.basis ++ Applicabilities.references(v.applicability) ++ content(v.content)
    case GraphRecord.Edge(v) => v.sources ++ v.targets ++ detail(v.detail) ++ Applicabilities.references(v.applicability)
    case GraphRecord.Contract(v) => v.definition :: v.context
    case GraphRecord.Progress(v) => v.subject :: (v.previous.toList ++ v.evidence ++ v.gateBasis.references ++ v.gateBasis.selectionWitnesses)
    case GraphRecord.Selection(v) => v.binding :: v.basis
    case GraphRecord.Person(_) | GraphRecord.Input(_) => Nil
  }
}
