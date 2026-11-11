package ontology.domain

import ontology.api.*

object RelationValidation {
  def authoring(graph: GraphSnapshot, relation: Relation, evidence: List[ReviewEvidence]): Unit = validate(graph, relation, evidence, false)
  def retained(graph: GraphSnapshot, relation: Relation, evidence: List[ReviewEvidence]): Unit = validate(graph, relation, evidence, true)
  private def empty(r: Relation): Unit = Require(r.detail.isInstanceOf[RelationDetail.Empty], "detail", "unexpected relation detail")
  private def validate(g: GraphSnapshot, r: Relation, reviewEvidence: List[ReviewEvidence], retained: Boolean): Unit = {
    Require(r.why.trim.nonEmpty && r.sources.nonEmpty && r.targets.nonEmpty, "relation", "relation explanation and endpoints required")
    Require(r.kind == RelationKind.Infers || r.sources.size == 1, "arity", "relation requires exactly one source")
    Require(Set(RelationKind.Decomposes, RelationKind.Assesses).contains(r.kind) || r.targets.size == 1, "arity", "relation requires exactly one target")
    (r.sources ++ r.targets).foreach(x => Require(Graph.exists(g, x), "reference", "unknown relation endpoint"))
    def task(ref: Ref): Unit = Require(Graph.node(g, ref).content.isInstanceOf[Content.Task], "kind", "task definition required")
    r.kind match {
      case RelationKind.DependsOn =>
        task(r.sources.head)
        val b = Graph.binding(g, r.targets.head); task(b.definition)
        r.detail match {
          case d: RelationDetail.Dependency =>
            Require(d.event.nonEmpty == (d.consumption == Consumption.Historical), "detail", "historical dependency requires exact completion event")
            d.event.foreach { e => Require(Graph.event(g, e).subject == b.ref && d.applicability.trim.nonEmpty, "detail", "historical event/applicability mismatch") }
          case _ => throw Fault("detail", "dependency gate/consumption required")
        }
      case RelationKind.Requires =>
        Graph.binding(g, r.targets.head)
        Graph.node(g, r.sources.head).content match {
          case _: Content.Task => empty(r)
          case _: Content.Decision => r.detail match {
            case value: RelationDetail.PlanRequirement => Require(value.workContext.trim.nonEmpty, "detail", "plan requirement work context required")
            case _ => throw Fault("detail", "Decision requirement must name its work context")
          }
          case _ => throw Fault("kind", "requirement source must be a Task or selected Decision plan")
        }
      case RelationKind.Decomposes =>
        Require(r.detail.isInstanceOf[RelationDetail.Decomposition], "detail", "decomposition meaning required")
        (r.sources ++ r.targets).foreach(x => Graph.node(g, x))
      case RelationKind.Delegates => Require(r.detail.isInstanceOf[RelationDetail.Delegation], "detail", "delegation bounds required")
      case RelationKind.Adopts | RelationKind.Chooses => r.detail match {
        case a: RelationDetail.Adoption =>
          Require(retained || a.origin == AdoptionOrigin.Interpretation, "protected", "captured Human action requires the presentation/judgment endpoint")
          Adoptions.validate(g, r, a, reviewEvidence)
          if (a.origin == AdoptionOrigin.CapturedAction) {
            val evidence = reviewEvidence.find(value => value.presentation.id == a.presentationId && value.judgment.source == a.response)
              .getOrElse(throw Fault("corrupt", "captured action evidence missing"))
            Require(ReviewRecords.relation(evidence.judgment, Graph.node(g, evidence.judgment.source).provenance).contains(r), "corrupt", "captured action differs from retained activity")
          }
        case _ => throw Fault("detail", "adoption presentation binding required")
      }
      case RelationKind.AssignedTo => task(r.sources.head); Require(g.actors.exists(_.ref == r.targets.head), "kind", "assignment target must be a captured actor"); empty(r)
      case RelationKind.Quotes | RelationKind.Interprets =>
        Graph.node(g, r.sources.head)
        Graph.node(g, r.targets.head); empty(r)
      case RelationKind.PlannedOutput =>
        task(r.sources.head)
        Require(g.definitions.exists(d => d.ref == r.targets.head && !d.content.isInstanceOf[Content.Source] && !d.content.isInstanceOf[Content.Artifact]), "kind", "planned output requires an intended definition, not a produced artifact or actor")
        empty(r)
      case RelationKind.Produced =>
        Require(Graph.node(g, r.targets.head).content.isInstanceOf[Content.Artifact], "kind", "produced target must be captured artifact")
        g.events.find(_.ref == r.sources.head) match {
          case Some(event) => Require(event.phase == Phase.Completed, "kind", "produced state source must describe completed work")
          case None =>
            val source = Graph.node(g, r.sources.head)
            source.content match {
              case value: Content.Source => value.descriptor match {
                case primary: SourceDescriptor.PrimaryCapture =>
                  Require(source.provenance.contributor.kind == ActorKind.Service && primary.origin == EventOrigin.ToolOutput &&
                    primary.metadata.representation == SourceRepresentation.HostReceipt && primary.reviewResponse.isEmpty,
                    "kind", "protected execution capture required")
                  primary.observation match {
                    case execution: Observation.Execution => Require(execution.outputs.contains(r.targets.head), "produced-output", "artifact was not recorded as this execution's output")
                    case _ => throw Fault("kind", "execution observation required")
                  }
                case _ => throw Fault("kind", "derived presentation is not an execution capture")
              }
              case _ => throw Fault("kind", "produced source must be completed work or a captured execution")
            }
        }
        empty(r)
      case RelationKind.Assesses =>
        r.targets.foreach(x => Graph.binding(g, x))
        Graph.node(g, r.sources.head).content match {
          case review: Content.Review => Require(r.targets.forall(review.subjects.contains), "assessment-subject", "assessment edge and review subjects disagree")
          case _ => throw Fault("kind", "assessment source must be an explicit review")
        }
        empty(r)
      case RelationKind.UsesAssessment => Gates.validateUse(g, r)
      case RelationKind.Answers => Require(Graph.node(g, r.targets.head).content.isInstanceOf[Content.Question], "kind", "answer target must be a question"); empty(r)
      case _ => empty(r)
    }
  }
}
