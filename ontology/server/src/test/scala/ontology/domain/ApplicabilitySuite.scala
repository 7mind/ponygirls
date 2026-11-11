package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.Wire
import java.util.UUID

final class ApplicabilitySuite extends FunSuite {
  private val engine = new AdmissionEngine
  private val a = Applicability.Declared("Only component A", Nil, Nil)
  private val b = Applicability.Declared("Only component B", Nil, Nil)
  private def run(graph: GraphSnapshot, operations: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(graph, ApplyRequest(graph.scope, id, graph.generation, operations), Admission(Actor("agent", ActorKind.Agent), Actor("host", ActorKind.Service), id, "2026-11-11T00:00:00Z"))
  }
  private def ref(value: Applied, name: String): Ref = value.result.created.find(_.alias == name).get.ref
  private def task: Content = Content.Task("Build", Acceptance(List("observable result"), None), Execution.Delegated)
  test("unresolved and declared applicability remain distinct through codecs") {
    val values = List[Applicability](a, Applicability.Unresolved("Needs source clarification", Nil, Nil))
    values.foreach(value => assertEquals(Wire.decode(Applicability.codecJson, Wire.encode(Applicability.codecJson, value)), value))
  }
  test("applicability-only definition change requires a new binding and preserves old progress") {
    val initial = run(Graph.empty("project"), List(Operation.Create("task", a, task, Nil), Operation.Create("evidence", a, Content.Statement("Reported check", Modality.Assertion), Nil), Operation.Bind("binding", Target.Created("task"), Nil), Operation.State("done", Target.Created("binding"), None, Phase.Completed, Some(Resolution.Fulfilled), Some("reported complete"), List(Target.Created("evidence")), "reported")))
    val revised = run(initial.snapshot, List(Operation.Revise("new", ref(initial, "task"), b, task, Standing.Active, List(Target.Exact(ref(initial, "evidence"))), "Scope-only correction")))
    assertEquals(Graph.node(revised.snapshot, ref(revised, "new")).content, task)
    assertEquals(Graph.node(revised.snapshot, ref(initial, "task")).applicability, a)
    assertEquals(Graph.event(revised.snapshot, ref(initial, "done")).result, Some(Resolution.Fulfilled))
    assertEquals(intercept[Fault](Graph.validateBinding(revised.snapshot, Graph.binding(revised.snapshot, ref(initial, "binding")))).code, "stale-context")
    val rebound = run(revised.snapshot, List(Operation.Bind("current", Target.Exact(ref(revised, "new")), Nil)))
    Graph.validateBinding(rebound.snapshot, Graph.binding(rebound.snapshot, ref(rebound, "current")))
  }
  test("scope-only relation revision preserves identity and invalidates the affected binding") {
    val initial = run(Graph.empty("project"), List(Operation.Create("task", a, task, Nil), Operation.Create("output", a, Content.Outcome("Delivery", Acceptance(List("contract"), None), Force.Required), Nil), Operation.Relate("edge", a, RelationKind.PlannedOutput, List(Target.Created("task")), List(Target.Created("output")), RelationDetail.Empty(), "Chosen output"), Operation.Bind("binding", Target.Created("task"), List(Target.Created("edge")))))
    val edge = Graph.relation(initial.snapshot, ref(initial, "edge"))
    val revised = run(initial.snapshot, List(Operation.ReviseRelation("new", edge.ref, b, edge.sources.map(Target.Exact(_)), edge.targets.map(Target.Exact(_)), edge.detail, "Only applicability changes", Standing.Active)))
    assertEquals(ref(revised, "new").id, edge.ref.id)
    assertEquals(ref(revised, "new").revision, 2)
    assertEquals(intercept[Fault](Graph.validateBinding(revised.snapshot, Graph.binding(revised.snapshot, ref(initial, "binding")))).code, "missing-context")
  }
  test("captured applicability cannot be supplied through ordinary authoring") {
    val error = intercept[Fault](run(Graph.empty("project"), List(Operation.Create("fake", Applicability.Captured(Ref(UUID.randomUUID(), 1)), task, Nil))))
    assertEquals(error.code, "protected")
  }
  test("scope basis and capture contexts require real exact Source references") {
    val initial = run(Graph.empty("project"), List(Operation.Create("claim", a, Content.Statement("Not an authenticated source", Modality.Assertion), Nil)))
    val claim = ref(initial, "claim")
    val invalid = List[Applicability](Applicability.Declared("Scope", List(claim), Nil), Applicability.Declared("Scope", Nil, List(ApplicabilityContext.Capture(claim))), Applicability.Declared(" ", Nil, Nil), Applicability.Unresolved("", Nil, Nil))
    invalid.foreach(value => assertEquals(intercept[Fault](run(initial.snapshot, List(Operation.Create("x", value, task, Nil)))).code, "applicability"))
    val dangling = Applicability.Declared("Scope", Nil, List(ApplicabilityContext.Subject(Ref(UUID.randomUUID(), 1))))
    assertEquals(intercept[Fault](run(initial.snapshot, List(Operation.Create("x", dangling, task, Nil)))).code, "reference")
    assertEquals(initial.snapshot.definitions.size, 1)
  }
}
