package ontology.domain

import ontology.api.*
import java.util.UUID
import munit.FunSuite
import baboon.runtime.shared.BaboonCodecContext

final class AdmissionReviewReproductions extends FunSuite {
  private val engine = new AdmissionEngine
  private def exact(r: Ref): Target = Target.Exact(r)
  private def task(s: String): Content.Task = Content.Task(s, Acceptance(List("observable contract"), None), Execution.Delegated)
  private def run(g: GraphSnapshot, ops: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(g, ApplyRequest(g.scope, id, g.generation, ops, None), Admission(ontology.TestContexts.principal(g.scope, Actor("curator", ActorKind.Agent)), Actor("host", ActorKind.Service), id, "2026-11-10T00:00:00Z", ontology.TestContexts.trace("fixture-apply"), Nil))
  }
  private def ref(x: Applied, alias: String): Ref = x.result.created.find(_.alias == alias).get.ref
  test("revision rationale survives the published immutable account") {
    val initial = run(Graph.empty("s"), List(Operation.Create("work", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("First")), Nil), Operation.Create("basis", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Clarification", Modality.Assertion)), Nil)))
    val reason = "Correct the earlier interpretation, not a new Human instruction"
    val changed = run(initial.snapshot, List(Operation.Revise("revised", ref(initial, "work"), ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Corrected")), Standing.Active, List(exact(ref(initial, "basis"))), reason)))
    val wire = Definition.codecJson.encode(BaboonCodecContext.Default, changed.snapshot.definitions.last)
    assertEquals(wire.hcursor.get[String]("changeReason"), Right(reason))
  }
  test("historical completion reuse does not create a current self-dependency") {
    val initial = run(Graph.empty("s"), List(Operation.Create("work", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Probe")), Nil), Operation.Create("basis", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Observed bounded result", Modality.Assertion)), Nil), Operation.Bind("b1", Target.Created("work"), Nil, "fixture"), Operation.SelectBinding("b1-selection", Target.Created("b1"), true, "Selected by this fixture", List(Target.Created("work"))), Operation.State("done", Target.Created("b1"), None, Phase.Completed, Some(Resolution.Fulfilled), Some("Probe completed"), List(Target.Created("basis")), "bounded")))
    val revised = run(initial.snapshot, List(Operation.Revise("d2", ref(initial, "work"), ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Use prior probe under revised scope")), Standing.Active, List(exact(ref(initial, "basis"))), "New scope with explicit reuse")))
    val linked = run(revised.snapshot, List(Operation.Relate("history", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.DependsOn, List(exact(ref(revised, "d2"))), List(exact(ref(initial, "b1"))), ontology.TestAuthoring.detail(RelationDetail.Dependency(Gate.Fulfillment, Consumption.Historical, Some(ref(initial, "done")), "Earlier bounded probe applies to this selected step")), "Explicit historical result reuse")))
    assertEquals(linked.snapshot.relations.last.kind, RelationKind.DependsOn)
  }
  test("a review of U cannot satisfy condition C by adding an unrelated assesses edge") {
    val initial = run(Graph.empty("s"), List(Operation.Create("c", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Required condition", Modality.Assertion)), Nil), Operation.Bind("cb", Target.Created("c"), Nil, "fixture"), Operation.SelectBinding("cb-selection", Target.Created("cb"), true, "Selected by this fixture", List(Target.Created("c"))), Operation.Create("u", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Statement("Unrelated subject", Modality.Assertion)), Nil), Operation.Bind("ub", Target.Created("u"), Nil, "fixture"), Operation.SelectBinding("ub-selection", Target.Created("ub"), true, "Selected by this fixture", List(Target.Created("u"))), Operation.Create("t", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Dependent action")), Nil)))
    val reviewed = run(initial.snapshot, List(Operation.Create("review", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Review("Only U assessed", List("Supported U"), List(ref(initial, "ub")), Nil, "", Assessment.Supported)), Nil)))
    val error = intercept[Fault] {
      run(reviewed.snapshot, List(
        Operation.Relate("miswire", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Assesses, List(exact(ref(reviewed, "review"))), List(exact(ref(initial, "cb"))), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Not actually the review subject"),
        Operation.Relate("requires", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Requires, List(exact(ref(initial, "t"))), List(exact(ref(initial, "cb"))), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Required condition"),
        Operation.Bind("tb", exact(ref(initial, "t")), List(Target.Created("requires")), "fixture"), Operation.SelectBinding("tb-selection", Target.Created("tb"), true, "Selected by this fixture", List(exact(ref(initial, "t")))),
        Operation.State("start", Target.Created("tb"), None, Phase.Active, None, None, Nil, "")
      ))
    }
    assert(Set("assessment-subject", "condition").contains(error.code))
  }
}
