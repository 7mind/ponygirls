package ontology.domain

import ontology.api.*

/** Resolves operation input without allocating identities or changing persisted types. */
object Authoring {
  def acceptance(value: AcceptanceInput, resolve: Target => Ref): Acceptance =
    Acceptance(value.clauses, value.question.map(resolve))

  def content(value: ContentInput, resolve: Target => Ref): Content = value match {
    case v: ContentInput.Outcome => Content.Outcome(v.text, acceptance(v.acceptance, resolve), v.force)
    case v: ContentInput.Constraint => Content.Constraint(v.text, v.polarity, v.force)
    case v: ContentInput.Task => Content.Task(v.text, acceptance(v.acceptance, resolve), v.execution)
    case v: ContentInput.Statement => Content.Statement(v.text, v.modality)
    case v: ContentInput.Hypothesis => Content.Hypothesis(v.text, v.prediction)
    case v: ContentInput.Defect => Content.Defect(v.text, v.observed, v.expected, v.reproduction, v.affected.map(resolve), v.correction)
    case v: ContentInput.Question => Content.Question(v.text, v.alternatives, v.answer, v.escalation)
    case v: ContentInput.Decision => Content.Decision(v.text, v.alternatives, v.rationale)
    case v: ContentInput.Review => Content.Review(v.text, v.findings, v.subjects.map(resolve), v.basis.map(resolve), v.uncertainty, v.assessment)
    case v: ContentInput.Conflict => Content.Conflict(v.text, v.subjects.map(resolve), v.status, v.resolution, v.uncertainty)
  }

  def applicabilityContext(value: ApplicabilityContextInput, resolve: Target => Ref): ApplicabilityContext = value match {
    case v: ApplicabilityContextInput.Capture => ApplicabilityContext.Capture(resolve(v.source))
    case v: ApplicabilityContextInput.Subject => ApplicabilityContext.Subject(resolve(v.ref))
  }

  def applicability(value: ApplicabilityInput, resolve: Target => Ref): Applicability = value match {
    case v: ApplicabilityInput.Unresolved => Applicability.Unresolved(v.reason, v.basis.map(resolve), v.context.map(applicabilityContext(_, resolve)))
    case v: ApplicabilityInput.Declared => Applicability.Declared(v.statement, v.basis.map(resolve), v.context.map(applicabilityContext(_, resolve)))
  }

  def relationDetail(value: RelationDetailInput, resolve: Target => Ref): RelationDetail = value match {
    case _: RelationDetailInput.Empty => RelationDetail.Empty()
    case v: RelationDetailInput.Dependency => RelationDetail.Dependency(v.gate, v.consumption, v.event.map(resolve), v.applicability)
    case v: RelationDetailInput.Decomposition => RelationDetail.Decomposition(v.grouping)
    case v: RelationDetailInput.Delegation => RelationDetail.Delegation(v.actors, v.operations, v.outcomes.map(resolve))
    case v: RelationDetailInput.Adoption => RelationDetail.Adoption(v.presentationId, v.origin)
  }
}
