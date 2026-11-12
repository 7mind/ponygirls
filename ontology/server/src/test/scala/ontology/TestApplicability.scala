package ontology

import ontology.api.Applicability

object TestApplicability {
  def unresolved: Applicability = Applicability.Unresolved("This fixture does not establish semantic applicability", Nil, Nil)
}
