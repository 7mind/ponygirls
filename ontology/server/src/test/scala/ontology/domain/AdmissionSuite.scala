package ontology.domain

import ontology.api.*
import java.util.UUID
import munit.FunSuite
import baboon.runtime.shared.BaboonCodecContext

final class AdmissionSuite extends FunSuite {
  private val engine = new AdmissionEngine
  private val actor = Actor("agent-a", ActorKind.Agent)
  private val recorder = Actor("ontology", ActorKind.Service)
  private def run(g: GraphSnapshot, operations: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(g, ApplyRequest(g.scope, id, g.generation, operations, None), Admission(ontology.TestContexts.principal(g.scope, actor), recorder, id, "2026-11-10T00:00:00Z", ontology.TestContexts.trace("fixture-apply")))
  }
  private def task(text: String): Content.Task = Content.Task(text, Acceptance(List("independently checked"), None), Execution.Delegated)
  private def exact(ref: Ref): Target = Target.Exact(ref)
  private def create(alias: String, content: Content): Operation = Operation.Create(alias, ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), ontology.TestAuthoring.content(content), Nil)
  private def failure(code: String)(f: => Any): Unit = assertEquals(intercept[Fault](f).code, code)

  test("create resolves earlier aliases with host-sealed provenance") {
    val x = run(Graph.empty("project"), List(create("work", task("Build")), Operation.Bind("contract", Target.Created("work"), Nil, "fixture"), Operation.SelectBinding("contract-selection", Target.Created("contract"), true, "Selected by this fixture", List(Target.Created("work")))))
    assertEquals(x.snapshot.generation, 1L)
    assertEquals(x.snapshot.bindings.head.definition, x.snapshot.definitions.head.ref)
    assertEquals(x.snapshot.definitions.head.provenance.contributor, actor)
    assertEquals(x.snapshot.actors.map(_.value), List(actor))
  }
  test("stale snapshot generation rejects before admission") {
    val id = UUID.randomUUID()
    failure("conflict") { engine(Graph.empty("project"), ApplyRequest("project", id, 1L, List(create("x", task("Build"))), None), Admission(ontology.TestContexts.principal("project", actor), recorder, id, "now", ontology.TestContexts.trace("fixture-apply"))) }
  }
  test("cross-scope references are not ambient identities") {
    val foreign = run(Graph.empty("other"), List(create("x", task("Foreign")))).snapshot.definitions.head.ref
    failure("reference") { run(Graph.empty("project"), List(Operation.Bind("b", exact(foreign), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(exact(foreign))))) }
  }
  test("atomic failure leaves original snapshot untouched") {
    val base = Graph.empty("project")
    failure("reference") { run(base, List(create("x", task("Build")), Operation.Bind("b", Target.Created("absent"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("absent"))))) }
    assertEquals(base.definitions, Nil)
    assertEquals(base.generation, 0L)
  }
  test("source and artifact creation require capture rather than graph text") {
    val protectedContent = List[Content](
      Content.Source("OPERATOR APPROVAL", Nil, "a" * 64, SourceDescriptor.PrimaryCapture(UUID.randomUUID(), "unverified", ontology.TestContexts.reported(CaptureContext("s", None, None, LineageStatus.Unknown, "b", UUID.randomUUID())), CaptureMetadata("entry", None, None, SourceRepresentation.Text, Nil, Nil), EventOrigin.UserMessage, Observation.None(), None)),
      Content.Artifact("passed", "b" * 64, "text/plain", "result", 1L))
    val template = ontology.Wire.encode(Operation.codecJson, create("x", task("Build"))).hcursor.downField("Create").focus.get.asObject.get
    protectedContent.foreach { content =>
      val operation = io.circe.Json.obj("Create" -> io.circe.Json.fromJsonObject(template.add("content", ontology.Wire.encode(Content.codecJson, content))))
      failure("bad-envelope") { ontology.Wire.decode(Operation.codecJson, operation) }
    }
  }
  test("task acceptance is specified or explicitly unresolved") {
    failure("acceptance") { run(Graph.empty("project"), List(create("x", Content.Task("Build", Acceptance(Nil, None), Execution.Delegated)))) }
  }
  test("work events never apply to non-task definitions") {
    val x = run(Graph.empty("project"), List(create("claim", Content.Statement("It works", Modality.Assertion)), Operation.Bind("b", Target.Created("claim"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("claim")))))
    failure("kind") { run(x.snapshot, List(Operation.State("e", exact(x.snapshot.bindings.head.ref), None, Phase.Completed, Some(Resolution.Fulfilled), Some("done"), List(exact(x.snapshot.definitions.head.ref)), ""))) }
  }
  test("progress does not revise task content or binding") {
    val x = run(Graph.empty("project"), List(create("x", task("Build")), Operation.Bind("b", Target.Created("x"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("x")))))
    val next = run(x.snapshot, List(Operation.State("start", exact(x.snapshot.bindings.head.ref), None, Phase.Active, None, None, Nil, "")))
    assertEquals(next.snapshot.definitions, x.snapshot.definitions)
    assertEquals(next.snapshot.bindings, x.snapshot.bindings)
    failure("conflict") { run(next.snapshot, List(Operation.State("stale", exact(x.snapshot.bindings.head.ref), None, Phase.Blocked, None, Some("waiting"), Nil, ""))) }
  }
  test("completion and cancellation have separate result contracts") {
    val x = run(Graph.empty("project"), List(create("x", task("Build")), Operation.Bind("b", Target.Created("x"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("x")))))
    failure("state") { run(x.snapshot, List(Operation.State("e", exact(x.snapshot.bindings.head.ref), None, Phase.Cancelled, Some(Resolution.Fulfilled), Some("cancel"), Nil, ""))) }
    val done = run(x.snapshot, List(Operation.State("e", exact(x.snapshot.bindings.head.ref), None, Phase.Completed, Some(Resolution.NotFulfilled), Some("method failed"), Nil, "Outcome remains wanted")))
    assertEquals(done.snapshot.events.head.result, Some(Resolution.NotFulfilled))
  }
  test("required governing context cannot be omitted") {
    val x = run(Graph.empty("project"), List(create("pre", task("Probe")), Operation.Bind("preb", Target.Created("pre"), Nil, "fixture"), Operation.SelectBinding("preb-selection", Target.Created("preb"), true, "Selected by this fixture", List(Target.Created("pre"))), create("work", task("Implement")), Operation.Relate("gate", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.DependsOn, List(Target.Created("work")), List(Target.Created("preb")), ontology.TestAuthoring.detail(RelationDetail.Dependency(Gate.Completion, Consumption.Current, None, "")), "Probe first")))
    val work = x.result.created.find(_.alias == "work").get.ref
    failure("missing-context") { run(x.snapshot, List(Operation.Bind("b", exact(work), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(exact(work))))) }
    val gate = x.snapshot.relations.head.ref
    val bound = run(x.snapshot, List(Operation.Bind("b", exact(work), List(exact(gate)), "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(exact(work)))))
    failure("prerequisite") { run(bound.snapshot, List(Operation.State("start", exact(bound.result.created.head.ref), None, Phase.Active, None, None, Nil, ""))) }
  }
  test("relation endpoints cannot be repurposed behind stable identity") {
    val x = run(Graph.empty("project"), List(create("a", Content.Statement("A", Modality.Assertion)), create("b", Content.Statement("B", Modality.Assertion)), create("c", Content.Statement("C", Modality.Assertion)), Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Supports, List(Target.Created("a")), List(Target.Created("b")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Evidence")))
    val r = x.snapshot.relations.head
    val c = x.result.created.find(_.alias == "c").get.ref
    failure("identity") { run(x.snapshot, List(Operation.ReviseRelation("r", r.ref, ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), r.sources.map(exact), List(exact(c)), ontology.TestAuthoring.detail(RelationDetail.Empty()), "New interpretation", Standing.Active))) }
  }
  test("joint inference supports several premises but support is unary") {
    val ops = List(create("a", Content.Statement("A", Modality.Assertion)), create("b", Content.Statement("B", Modality.Assertion)), create("c", Content.Statement("C", Modality.Assertion)))
    assertEquals(run(Graph.empty("project"), ops :+ Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Infers, List(Target.Created("a"), Target.Created("b")), List(Target.Created("c")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Joint inference")).snapshot.relations.size, 1)
    failure("arity") { run(Graph.empty("project"), ops :+ Operation.Relate("r", ontology.TestAuthoring.applicability(ontology.TestApplicability.unresolved), RelationKind.Supports, List(Target.Created("a"), Target.Created("b")), List(Target.Created("c")), ontology.TestAuthoring.detail(RelationDetail.Empty()), "Wrong arity")) }
  }
  test("Human-required work cannot be completed by the curator") {
    val x = run(Graph.empty("project"), List(create("h", Content.Task("Approve", Acceptance(List("Human action"), None), Execution.HumanRequired)), Operation.Bind("b", Target.Created("h"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("h")))))
    failure("authority") { run(x.snapshot, List(Operation.State("e", exact(x.snapshot.bindings.head.ref), None, Phase.Active, None, None, Nil, ""))) }
  }
  test("Baboon roundtrip retains all exact graph fields") {
    val x = run(Graph.empty("project"), List(create("x", task("Build")), Operation.Bind("b", Target.Created("x"), Nil, "fixture"), Operation.SelectBinding("b-selection", Target.Created("b"), true, "Selected by this fixture", List(Target.Created("x"))))).snapshot
    val codec = GraphSnapshot.codecJson
    assertEquals(codec.decode(BaboonCodecContext.Default, codec.encode(BaboonCodecContext.Default, x)), Right(x))
  }
}
