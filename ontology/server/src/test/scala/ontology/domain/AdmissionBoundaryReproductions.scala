package ontology.domain

import ontology.api.*
import java.util.UUID
import munit.FunSuite
import baboon.runtime.shared.BaboonCodecContext

final class AdmissionBoundaryReproductions extends FunSuite {
  private val engine = new AdmissionEngine
  private val actor = Actor("curator", ActorKind.Agent)
  private def exact(r: Ref): Target = Target.Exact(r)
  private def task(s: String): Content.Task = Content.Task(s, Acceptance(List("observable contract"), None), Execution.Delegated)
  private def run(g: GraphSnapshot, ops: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(g, ApplyRequest(g.scope, id, g.generation, ops, None), Admission(ontology.TestContexts.principal(g.scope, actor), Actor("host", ActorKind.Service), id, "now", ontology.TestContexts.trace("fixture-apply")))
  }
  private def ref(x: Applied, alias: String): Ref = x.result.created.find(_.alias == alias).get.ref
  test("planned output cannot point to an actor record") {
    val x = run(Graph.empty("s"), List(Operation.Create("task", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Work")), Nil)))
    val error = intercept[Fault] { run(x.snapshot, List(Operation.Relate("output", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.PlannedOutput, List(exact(ref(x, "task"))), List(exact(x.snapshot.actors.head.ref)), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Intended deliverable"))) }
    assertEquals(error.code, "kind")
  }
  test("changed output acceptance invalidates an old work binding") {
    val x = run(Graph.empty("s"), List(Operation.Create("task", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Work")), Nil), Operation.Create("output", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Outcome("Delivery", Acceptance(List("old"), None), Force.Required)), Nil), Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.PlannedOutput, List(Target.Created("task")), List(Target.Created("output")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Acceptance scope"), Operation.Bind("b", Target.Created("task"), List(Target.Created("r")), "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("task")))))
    val revised = run(x.snapshot, List(Operation.Revise("v2", ref(x, "output"), ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(Content.Outcome("Delivery", Acceptance(List("new"), None), Force.Required)), Standing.Active, List(exact(ref(x, "task"))), "Changed output contract")))
    val error = intercept[Fault] { run(revised.snapshot, List(Operation.State("start", exact(ref(x, "b")), None, Phase.Active, None, None, Nil, ""))) }
    assertEquals(error.code, "stale-context")
  }
  test("a merely planned event cannot establish a produced relation") {
    val artifact = Definition(Ref(UUID.randomUUID(), 1), "s", ontology.TestApplicability.unresolved, Content.Artifact("Captured bytes", "a" * 64, "text/plain", "logical/file", 1L), Standing.Active, Nil, None, Provenance(Actor("capture", ActorKind.Collector), Actor("host", ActorKind.Service), UUID.randomUUID(), "now"))
    val base = Graph.empty("s").copy(definitions = List(artifact))
    val error = intercept[Fault] {
      run(base, List(Operation.Create("task", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Work")), Nil), Operation.Bind("b", Target.Created("task"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("task"))), Operation.State("plan", Target.Created("b"), None, Phase.Planned, None, None, Nil, ""), Operation.Relate("produced", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Produced, List(Target.Created("plan")), List(exact(artifact.ref)), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Not executed")))
    }
    assertEquals(error.code, "kind")
  }
  test("strict wire admission rejects unknown operation fields") {
    val value: Operation = Operation.Create("work", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(task("Work")), Nil)
    val encoded = Operation.codecJson.encode(BaboonCodecContext.Default, value)
    val obj = encoded.asObject.get
    val key = obj.keys.head
    val changed = encoded.mapObject(_.add(key, obj(key).get.mapObject(_.add("unrecognized", io.circe.Json.True))))
    assertEquals(intercept[Fault](ontology.Wire.decode(Operation.codecJson, changed)).code, "bad-envelope")
    assertEquals(ontology.Wire.decode(Operation.codecJson, encoded), value)
  }
  test("unknown root lineage is representable without fabricating a root session") {
    val encoded = io.circe.Json.obj("sessionId" -> io.circe.Json.fromString("native"), "rootSessionId" -> io.circe.Json.Null, "parentSessionId" -> io.circe.Json.Null, "lineage" -> io.circe.Json.fromString("Unknown"), "branch" -> io.circe.Json.fromString("leaf"), "epoch" -> io.circe.Json.fromString(UUID.randomUUID().toString))
    assert(CaptureContext.codecJson.decode(BaboonCodecContext.Default, encoded).isRight)
  }
}
