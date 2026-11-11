package ontology.domain

import ontology.api.*

object PlanRequirements {
  def isPlan(relation: Relation): Boolean = relation.kind == RelationKind.Requires && relation.detail.isInstanceOf[RelationDetail.PlanRequirement]
  private def selected(graph: GraphSnapshot, relation: Relation): Option[Binding] = Selections.latest(graph).filter(_.selected)
    .map(value => Graph.binding(graph, value.binding)).find(binding => Graph.governs(relation, binding) && binding.context.contains(relation.ref))

  def validateAdmission(graph: GraphSnapshot, relation: Relation): Unit = {
    val binding = selected(graph, relation).getOrElse(throw Fault("plan-selection", "requirement needs a selected plan binding in its declared work context"))
    Graph.validateSelectedBinding(graph, binding)
  }

  def visibleCurrent(graph: GraphSnapshot, relation: Relation): Boolean = {
    if (!isPlan(relation) || relation.standing != Standing.Active) true
    else selected(graph, relation).exists { binding =>
      try { Graph.validateSelectedBinding(graph, binding); true }
      catch { case fault: Fault if Set("stale-context", "missing-context", "unselected-context").contains(fault.code) => false }
    }
  }
}
