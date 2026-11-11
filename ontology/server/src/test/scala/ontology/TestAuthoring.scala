package ontology

import ontology.api.*

object TestAuthoring {
  private def acceptance(value: Acceptance): AcceptanceInput = AcceptanceInput(value.clauses, value.question.map(Target.Exact(_)))
  def content(value: Content): ContentInput = value match {
    case v: Content.Outcome => ContentInput.Outcome(v.text, acceptance(v.acceptance), v.force)
    case v: Content.Constraint => ContentInput.Constraint(v.text, v.polarity, v.force)
    case v: Content.Task => ContentInput.Task(v.text, acceptance(v.acceptance), v.execution)
    case v: Content.Statement => ContentInput.Statement(v.text, v.modality)
    case v: Content.Hypothesis => ContentInput.Hypothesis(v.text, v.prediction)
    case v: Content.Defect => ContentInput.Defect(v.text, v.observed, v.expected, v.reproduction, v.affected.map(Target.Exact(_)), v.correction)
    case v: Content.Question => ContentInput.Question(v.text, v.alternatives, v.answer, v.escalation)
    case v: Content.Decision => ContentInput.Decision(v.text, v.alternatives, v.rationale)
    case v: Content.Review => ContentInput.Review(v.text, v.findings, v.subjects.map(Target.Exact(_)), v.basis.map(Target.Exact(_)), v.uncertainty, v.assessment)
    case v: Content.Conflict => ContentInput.Conflict(v.text, v.subjects.map(Target.Exact(_)), v.status, v.resolution, v.uncertainty)
    case _: Content.Source | _: Content.Artifact => throw new IllegalArgumentException("Protected records require wire rejection tests, not ordinary input fixtures")
  }
  private def context(value: ApplicabilityContext): ApplicabilityContextInput = value match {
    case v: ApplicabilityContext.Capture => ApplicabilityContextInput.Capture(Target.Exact(v.source))
    case v: ApplicabilityContext.Subject => ApplicabilityContextInput.Subject(Target.Exact(v.ref))
  }
  def applicability(value: Applicability): ApplicabilityInput = value match {
    case v: Applicability.Unresolved => ApplicabilityInput.Unresolved(v.reason, v.basis.map(Target.Exact(_)), v.context.map(context))
    case v: Applicability.Declared => ApplicabilityInput.Declared(v.statement, v.basis.map(Target.Exact(_)), v.context.map(context))
    case _: Applicability.Captured => throw new IllegalArgumentException("Captured applicability requires a wire rejection test")
  }
  def detail(value: RelationDetail): RelationDetailInput = value match {
    case _: RelationDetail.Empty => RelationDetailInput.Empty()
    case v: RelationDetail.Dependency => RelationDetailInput.Dependency(v.gate, v.consumption, v.event.map(Target.Exact(_)), v.applicability)
    case v: RelationDetail.Decomposition => RelationDetailInput.Decomposition(v.grouping)
    case v: RelationDetail.Delegation => RelationDetailInput.Delegation(v.actors, v.operations, v.outcomes.map(Target.Exact(_)))
    case v: RelationDetail.Adoption => RelationDetailInput.Adoption(v.presentationId, v.origin)
    case v: RelationDetail.AssessmentUse => RelationDetailInput.AssessmentUse(Target.Exact(v.requirement), v.disposition, v.basis.map(Target.Exact(_)))
  }
}
