package ontology.domain

import ontology.api.*
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8

final class AdmissionEngine {
  private val taskPhases = Set(Phase.Planned, Phase.Active, Phase.Blocked, Phase.Completed, Phase.Cancelled)
  private val inquiryPhases = Set(Phase.Open, Phase.Resolved)
  def apply(base: GraphSnapshot, request: ApplyRequest, admission: Admission): Applied = {
    Require(request.scope == base.scope, "scope", "scope mismatch")
    Require(request.requestId == admission.requestId, "request", "request binding mismatch")
    Require(request.expectedGeneration == base.generation, "conflict", "graph generation changed")
    Require(request.operations.nonEmpty, "operations", "empty transaction")
    val actorRef = Ref(UUID.nameUUIDFromBytes(("actor:" + admission.actor.kind.toString + ":" + admission.actor.id).getBytes(UTF_8)), 1)
    var graph = if (base.actors.exists(_.ref == actorRef)) base else base.copy(actors = base.actors :+ ActorRecord(actorRef, admission.actor))
    var aliases = Map.empty[String, Ref]
    def resolve(target: Target): Ref = target match {
      case Target.Exact(ref) => Require(Graph.exists(graph, ref), "reference", "unknown exact reference"); ref
      case Target.Created(alias) => aliases.getOrElse(alias, throw Fault("reference", "unknown earlier alias"))
    }
    def refs(xs: List[Target]): List[Ref] = { val values = xs.map(resolve); Require(values.distinct == values, "reference", "duplicate references"); values }
    def aliasOf(op: Operation): String = op match {
      case x: Operation.Create => x.alias; case x: Operation.Revise => x.alias; case x: Operation.Relate => x.alias
      case x: Operation.ReviseRelation => x.alias; case x: Operation.Bind => x.alias; case x: Operation.SelectBinding => x.alias; case x: Operation.State => x.alias
    }
    def writable(content: Content): Unit = Require(!content.isInstanceOf[Content.Source] && !content.isInstanceOf[Content.Artifact], "protected", "source and artifact records require trusted capture")
    request.operations.foreach { operation =>
      val alias = aliasOf(operation)
      Require(alias.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") && !aliases.contains(alias), "alias", "invalid or duplicate alias")
      val fresh = admission.ref(alias)
      Require(!Graph.exists(graph, fresh), "identity", "new identity already exists")
      val published: Ref = operation match {
        case x: Operation.Create =>
          val content = Authoring.content(x.content, resolve)
          val applicability = Authoring.applicability(x.applicability, resolve)
          writable(content); Graph.validateContent(graph, content); Applicabilities.validate(graph, applicability, false)
          val d = Definition(fresh, graph.scope, applicability, content, Standing.Active, refs(x.basis), None, admission.provenance)
          graph = graph.copy(definitions = graph.definitions :+ d); fresh
        case x: Operation.Revise =>
          val old = Graph.node(graph, x.ref)
          Require(Graph.definitions(graph).exists(_.ref == x.ref), "conflict", "definition revision changed")
          writable(old.content)
          val content = Authoring.content(x.content, resolve)
          val applicability = Authoring.applicability(x.applicability, resolve)
          writable(content); Graph.validateContent(graph, content); Applicabilities.validate(graph, applicability, false)
          Require(x.reason.trim.nonEmpty, "content", "revision reason required")
          val basis = refs(x.basis)
          Require(basis.nonEmpty, "basis", "revisions require an inspectable change basis")
          val next = Ref(old.ref.id, Math.addExact(old.ref.revision, 1))
          graph = graph.copy(definitions = graph.definitions :+ Definition(next, graph.scope, applicability, content, x.standing, basis, Some(x.reason), admission.provenance)); next
        case x: Operation.Relate =>
          val applicability = Authoring.applicability(x.applicability, resolve)
          val detail = Authoring.relationDetail(x.detail, resolve)
          Applicabilities.validate(graph, applicability, false)
          val r = Relation(fresh, graph.scope, applicability, x.kind, refs(x.sources), refs(x.targets), detail, x.why, Standing.Active, admission.provenance)
          validateRelation(graph, r)
          graph = graph.copy(relations = graph.relations :+ r); fresh
        case x: Operation.ReviseRelation =>
          val old = Graph.relation(graph, x.ref)
          Require(Graph.relations(graph).exists(_.ref == x.ref), "conflict", "relation revision changed")
          val sources = refs(x.sources); val targets = refs(x.targets)
          val detail = Authoring.relationDetail(x.detail, resolve)
          Require(old.sources == sources && old.targets == targets && old.detail == detail, "identity", "changed relation proposition requires explicit replacement")
          val applicability = Authoring.applicability(x.applicability, resolve)
          Applicabilities.validate(graph, applicability, false)
          val r = old.copy(ref = Ref(old.ref.id, Math.addExact(old.ref.revision, 1)), applicability = applicability, detail = detail, why = x.why, standing = x.standing, provenance = admission.provenance)
          validateRelation(graph, r); graph = graph.copy(relations = graph.relations :+ r); r.ref
        case x: Operation.Bind =>
          val b = Binding(fresh, graph.scope, resolve(x.definition), refs(x.context), x.workContext, admission.provenance)
          Graph.validateBinding(graph, b)
          graph = graph.copy(bindings = graph.bindings :+ b); fresh
        case x: Operation.SelectBinding =>
          val binding = Graph.binding(graph, resolve(x.binding))
          Require(x.reason.trim.nonEmpty, "selection", "selection explanation required")
          val basis = refs(x.basis)
          Require(basis.nonEmpty, "selection", "selection basis required")
          if (x.selected) Graph.validateBinding(graph, binding)
          else Require(Selections.selected(graph, binding), "selection", "only the selected binding can be retired")
          graph = graph.copy(selections = graph.selections :+ BindingSelection(fresh, graph.scope, binding.ref, x.selected, x.reason, basis, admission.provenance)); fresh
        case x: Operation.State =>
          val subject = resolve(x.subject); val b = Graph.binding(graph, subject)
          val task = Graph.node(graph, b.definition).content match {
            case t: Content.Task => Require(taskPhases.contains(x.phase), "state-kind", "task phase required"); Some(t)
            case _: Content.Question | _: Content.Review => Require(inquiryPhases.contains(x.phase), "state-kind", "question/review phase required"); None
            case _ => throw Fault("kind", "work progress requires a task, question or review binding")
          }
          Require(Graph.latestEvent(graph, subject).map(_.ref) == x.previous, "conflict", "previous event is not binding-local current head")
          Require(x.result.nonEmpty == (x.phase == Phase.Completed), "state", "only completed work has a result")
          Require(!Set(Phase.Completed, Phase.Cancelled, Phase.Blocked, Phase.Resolved).contains(x.phase) || x.resolution.exists(_.trim.nonEmpty), "state", "resolution required")
          if (Gates.requiresWarrant(x.phase)) Graph.validateSelectedBinding(graph, b)
          val executingTask = task.filter(_ => x.phase == Phase.Active || x.phase == Phase.Completed)
          executingTask.foreach(value => Require(value.acceptance.clauses.nonEmpty, "acceptance", "unresolved acceptance blocks execution and fulfillment"))
          val gateBasis = if (Gates.requiresWarrant(x.phase)) Gates.evaluate(graph, b) else GateBasis(Nil, Nil)
          executingTask.foreach { value =>
            if (value.execution == Execution.HumanRequired) Require(admission.actor.kind == ActorKind.Human, "authority", "Human-required task cannot be performed by an agent report")
          }
          val evidence = refs(x.evidence)
          Require(!x.result.contains(Resolution.Fulfilled) || evidence.nonEmpty, "evidence", "fulfilled report requires evidence")
          val e = StateEvent(fresh, graph.scope, subject, x.previous, x.phase, x.result, x.resolution, evidence, x.uncertainty, gateBasis, admission.provenance)
          graph = graph.copy(events = graph.events :+ e); fresh
      }
      aliases = aliases.updated(alias, published)
    }
    validateCycles(graph)
    // Later operations in the same transaction must not invalidate a new binding or completion.
    graph.bindings.drop(base.bindings.size).foreach(Graph.validateBinding(graph, _))
    val newSelections = graph.selections.drop(base.selections.size).map(_.ref).toSet
    Selections.latest(graph).filter(value => newSelections.contains(value.ref) && value.selected).foreach(value => Graph.validateSelectedBinding(graph, Graph.binding(graph, value.binding)))
    graph.events.drop(base.events.size).filter(e => Gates.requiresWarrant(e.phase)).foreach(Gates.validateEvent(graph, _))
    Applied(graph.copy(generation = Math.addExact(base.generation, 1L)), ApplyResult(request.scope, request.requestId, Math.addExact(base.generation, 1L), request.operations.map(op => AliasRef(aliasOf(op), aliases(aliasOf(op)))), false))
  }

  private def validateRelation(g: GraphSnapshot, r: Relation): Unit = {
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
      case RelationKind.Requires => task(r.sources.head); Graph.binding(g, r.targets.head); empty(r)
      case RelationKind.Decomposes =>
        Require(r.detail.isInstanceOf[RelationDetail.Decomposition], "detail", "decomposition meaning required")
        (r.sources ++ r.targets).foreach(x => Graph.node(g, x))
      case RelationKind.Delegates => Require(r.detail.isInstanceOf[RelationDetail.Delegation], "detail", "delegation bounds required")
      case RelationKind.Adopts | RelationKind.Chooses => r.detail match {
        case a: RelationDetail.Adoption => Require(a.origin == AdoptionOrigin.Interpretation, "protected", "captured Human action requires the presentation/judgment endpoint")
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
        Require(Graph.event(g, r.sources.head).phase == Phase.Completed, "kind", "produced source must describe completed work")
        Require(Graph.node(g, r.targets.head).content.isInstanceOf[Content.Artifact], "kind", "produced target must be captured artifact"); empty(r)
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
  private def empty(r: Relation): Unit = Require(r.detail.isInstanceOf[RelationDetail.Empty], "detail", "unexpected relation detail")
  private def validateCycles(g: GraphSnapshot): Unit = {
    val edges = Graph.relations(g).filter(_.standing == Standing.Active).flatMap { r =>
      if (r.kind == RelationKind.DependsOn && r.detail.asInstanceOf[RelationDetail.Dependency].consumption == Consumption.Current) List(r.sources.head.id -> Graph.binding(g, r.targets.head).definition.id)
      else if (r.kind == RelationKind.Decomposes && r.detail != RelationDetail.Decomposition(Grouping.Navigation)) r.targets.map(t => r.sources.head.id -> t.id)
      else Nil
    }
    def visit(node: UUID, path: Set[UUID]): Unit = {
      Require(!path.contains(node), "cycle", "active work/refinement cycle")
      edges.filter(_._1 == node).foreach(e => visit(e._2, path + node))
    }
    edges.map(_._1).distinct.foreach(visit(_, Set.empty))
  }
}
