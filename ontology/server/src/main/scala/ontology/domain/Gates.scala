package ontology.domain

import ontology.api.*

object Gates {
  private val reportPhases = Set(Phase.Active, Phase.Completed, Phase.Resolved)
  def requiresWarrant(phase: Phase): Boolean = reportPhases.contains(phase)
  private def canonical(values: Iterable[Ref]): List[Ref] = values.toSet.toList.sortBy(value => (value.id.toString, value.revision))
  private def declared(value: Applicability): Unit =
    Require(value.isInstanceOf[Applicability.Declared], "assessment-use", "declared semantic applicability required for assessment consumption")
  private def review(graph: GraphSnapshot, assessment: Relation): Definition = {
    val value = Graph.node(graph, assessment.sources.head)
    Require(value.content.isInstanceOf[Content.Review], "assessment-use", "assessment source must be a Review")
    value
  }
  def validateUse(graph: GraphSnapshot, use: Relation): Unit = {
    Require(use.sources.size == 1 && use.targets.size == 1, "assessment-use", "one assessment edge and consumer binding required")
    val detail = use.detail match { case value: RelationDetail.AssessmentUse => value; case _ => throw Fault("detail", "assessment-use detail required") }
    val assessment = Graph.relation(graph, use.sources.head)
    val consumer = Graph.binding(graph, use.targets.head)
    val requirement = Graph.relation(graph, detail.requirement)
    Require(assessment.kind == RelationKind.Assesses && requirement.kind == RelationKind.Requires, "assessment-use", "assessment and requirement relations required")
    Require(consumer.context.contains(requirement.ref) && Graph.governs(requirement, consumer), "assessment-use", "requirement must belong to this exact consumer contract")
    Require(requirement.targets.size == 1 && assessment.targets.contains(requirement.targets.head), "assessment-use", "assessment must address the required condition binding")
    val content = review(graph, assessment).content.asInstanceOf[Content.Review]
    Require(assessment.targets.forall(content.subjects.contains), "assessment-use", "assessment subjects disagree")
    Require(detail.basis.nonEmpty && detail.basis.distinct == detail.basis && detail.basis.forall(Graph.exists(graph, _)), "assessment-use", "distinct inspectable applicability basis required")
  }
  def references(basis: GateBasis): List[Ref] = canonical(basis.references ++ basis.selectionWitnesses)
  def evaluate(graph: GraphSnapshot, binding: Binding): GateBasis = evaluate(graph, binding, Set.empty)
  private def evaluate(graph: GraphSnapshot, binding: Binding, stack: Set[Ref]): GateBasis = {
    Require(!stack.contains(binding.ref), "cycle", "cyclic current gate consumption")
    Graph.validateSelectedBinding(graph, binding)
    val selection = Selections.current(graph, binding).getOrElse(throw Fault("unselected-context", "selected contract required"))
    val next = stack + binding.ref
    val consumed = List.newBuilder[Ref]
    val selectionWitnesses = List.newBuilder[Ref]
    consumed += binding.ref
    selectionWitnesses += selection.ref
    Graph.relations(graph).filter(r => r.standing == Standing.Active && binding.context.contains(r.ref) && Graph.governs(r, binding)).foreach { requirement =>
      requirement.kind match {
        case RelationKind.DependsOn =>
          val detail = requirement.detail.asInstanceOf[RelationDetail.Dependency]
          val prerequisite = Graph.binding(graph, requirement.targets.head)
          val event = if (detail.consumption == Consumption.Historical) Graph.event(graph, detail.event.get)
            else Graph.latestEvent(graph, prerequisite.ref).getOrElse(throw Fault("prerequisite", "predecessor has no reported state"))
          Require(event.phase == Phase.Completed, "prerequisite", "predecessor has not completed work")
          if (detail.gate == Gate.Fulfillment) Require(event.result.contains(Resolution.Fulfilled), "prerequisite", "predecessor has not fulfilled its contract")
          if (detail.consumption == Consumption.Current) validateEvent(graph, event, next)
          consumed ++= List(requirement.ref, prerequisite.ref, event.ref)
        case RelationKind.Requires =>
          val condition = Graph.binding(graph, requirement.targets.head)
          val candidates = Graph.relations(graph).filter(r => r.kind == RelationKind.Assesses && r.standing == Standing.Active && r.targets.contains(condition.ref))
          Require(candidates.nonEmpty, "condition", "required condition has no assessment")
          declared(Graph.node(graph, binding.definition).applicability)
          declared(Graph.node(graph, condition.definition).applicability)
          declared(requirement.applicability)
          val conditionSelection = Selections.current(graph, condition).getOrElse(throw Fault("unselected-context", "selected condition context required"))
          consumed ++= List(requirement.ref, condition.ref)
          selectionWitnesses += conditionSelection.ref
          var applicable = 0
          candidates.foreach { assessment =>
            val uses = Graph.relations(graph).filter { value =>
              value.kind == RelationKind.UsesAssessment && value.standing == Standing.Active && value.sources == List(assessment.ref) && value.targets == List(binding.ref) &&
                (value.detail match { case d: RelationDetail.AssessmentUse => d.requirement == requirement.ref; case _ => false })
            }
            Require(uses.size == 1, "assessment-use", "each candidate assessment requires one unambiguous consumer applicability account")
            val use = uses.head
            validateUse(graph, use)
            val detail = use.detail.asInstanceOf[RelationDetail.AssessmentUse]
            Require(detail.disposition != AssessmentUseDisposition.Unresolved, "assessment-use", "assessment applicability remains unresolved")
            declared(use.applicability)
            val assessed = review(graph, assessment)
            consumed ++= List(assessment.ref, assessed.ref, use.ref)
            consumed ++= detail.basis
            if (detail.disposition == AssessmentUseDisposition.Applicable) {
              Require(Graph.current(graph, assessed.ref) && assessed.standing == Standing.Active, "assessment-use", "stale Review cannot provide current support")
              declared(assessment.applicability)
              declared(assessed.applicability)
              Require(assessed.content.asInstanceOf[Content.Review].assessment == Assessment.Supported, "condition", "applicable assessment does not support the condition")
              applicable += 1
            }
          }
          Require(applicable > 0, "condition", "required condition has no applicable supporting assessment")
        case _ => ()
      }
    }
    GateBasis(canonical(consumed.result()), canonical(selectionWitnesses.result()))
  }
  def validateEvent(graph: GraphSnapshot, event: StateEvent): Unit = validateEvent(graph, event, Set.empty)
  private def validateEvent(graph: GraphSnapshot, event: StateEvent, stack: Set[Ref]): Unit = {
    Require(requiresWarrant(event.phase), "state", "event has no execution/resolution warrant")
    val recorded = event.gateBasis
    Require(recorded.references.distinct == recorded.references && recorded.selectionWitnesses.distinct == recorded.selectionWitnesses && references(recorded).forall(Graph.exists(graph, _)), "corrupt", "recorded gate basis contains missing or duplicate retained references")
    val binding = Graph.binding(graph, event.subject)
    val current = evaluate(graph, binding, stack)
    val selections = graph.selections.map(value => value.ref -> value).toMap
    def selectionMeaning(witnesses: List[Ref]): Set[Ref] = {
      val selectedBindings = witnesses.map { witness =>
        val selected = selections.getOrElse(witness, throw Fault("corrupt", "selection witness is not a selection record"))
        Require(selected.selected && Selections.selected(graph, Graph.binding(graph, selected.binding)), "stale-warrant", "recorded selection meaning no longer holds")
        selected.binding
      }
      Require(selectedBindings.distinct == selectedBindings, "corrupt", "duplicate selected-contract witness")
      selectedBindings.toSet
    }
    // Only the witness role permits a newer receipt selecting the same contract.
    Require(selectionMeaning(recorded.selectionWitnesses) == selectionMeaning(current.selectionWitnesses), "stale-warrant", "selected-contract witnesses differ from the recorded warrant")
    Require(canonical(recorded.references) == current.references, "stale-warrant", "current gate evidence differs from the recorded warrant")
  }
}
