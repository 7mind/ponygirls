package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.{TestApplicability, Wire}
import java.util.UUID

final class InquiryStateSuite extends FunSuite {
  private val engine = new AdmissionEngine
  private val question = Content.Question("Which evidence is available?", Nil, None, Escalation.HumanRequired)
  private def phase(value: String): Phase = Wire.decode(Phase_JsonCodec.instance, io.circe.Json.fromString(value))
  private def run(graph: GraphSnapshot, operations: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    engine(graph, ApplyRequest(graph.scope, id, graph.generation, operations), Admission(Actor("curator", ActorKind.Agent), Actor("host", ActorKind.Service), id, "2026-11-11T00:00:00Z"))
  }
  private def ref(value: Applied, alias: String): Ref = value.result.created.find(_.alias == alias).get.ref
  private def initial(content: Content): Applied = run(Graph.empty("inquiry"), List(
    Operation.Create("definition", ontology.TestAuthoring.applicability(TestApplicability.unresolved), ontology.TestAuthoring.content(content), Nil),
    Operation.Bind("binding", Target.Created("definition"), Nil)))
  private def state(alias: String, binding: Ref, previous: Option[Ref], name: String, reason: Option[String], evidence: List[Target]): Operation =
    Operation.State(alias, Target.Exact(binding), previous, phase(name), None, reason, evidence, "No conclusion about truth or approval")

  test("a question investigation can resolve inconclusively without inventing an answer") {
    val base = initial(question)
    val open = run(base.snapshot, List(state("open", ref(base, "binding"), None, "Open", None, Nil)))
    val done = run(open.snapshot, List(state("done", ref(base, "binding"), Some(ref(open, "open")), "Resolved", Some("Investigation ended; no answer established"), Nil)))
    assertEquals(Graph.node(done.snapshot, ref(base, "definition")).content, question)
    assertEquals(Graph.latestEvent(done.snapshot, ref(base, "binding")).get.phase.toString, "Resolved")
    assertEquals(Graph.latestEvent(done.snapshot, ref(base, "binding")).get.result, None)
  }

  test("resolved review can remain contradictory without changing findings or assessment") {
    val subject = initial(question)
    val review = Content.Review("Review the question", List("Evidence contradicts the premise"), List(ref(subject, "binding")), Nil, "Limited evidence", Assessment.Contradicted)
    val base = run(subject.snapshot, List(Operation.Create("review", ontology.TestAuthoring.applicability(TestApplicability.unresolved), ontology.TestAuthoring.content(review), Nil), Operation.Bind("review-binding", Target.Created("review"), Nil)))
    val done = run(base.snapshot, List(state("done", ref(base, "review-binding"), None, "Resolved", Some("Review finished and requests correction"), Nil)))
    assertEquals(Graph.node(done.snapshot, ref(base, "review")).content, review)
    assertEquals(done.snapshot.events.last.result, None)
  }

  test("work phase vocabulary is checked against the exact bound semantic kind") {
    val task = initial(Content.Task("Build", Acceptance(List("observable result"), None), Execution.Delegated))
    List("Open", "Resolved").foreach { name =>
      assertEquals(intercept[Fault](run(task.snapshot, List(state("wrong", ref(task, "binding"), None, name, Some("Not a task phase"), Nil)))).code, "state-kind")
    }
    val inquiry = initial(question)
    List("Planned", "Active", "Blocked", "Completed", "Cancelled").foreach { name =>
      assertEquals(intercept[Fault](run(inquiry.snapshot, List(state("wrong", ref(inquiry, "binding"), None, name, Some("Not a question phase"), Nil)))).code, "state-kind")
    }
  }

  test("resolved inquiry requires a reason and preserves binding-local event CAS") {
    val base = initial(question)
    assertEquals(intercept[Fault](run(base.snapshot, List(state("missing", ref(base, "binding"), None, "Resolved", None, Nil)))).code, "state")
    val done = run(base.snapshot, List(state("done", ref(base, "binding"), None, "Resolved", Some("No evidence available"), Nil)))
    assertEquals(intercept[Fault](run(done.snapshot, List(state("stale", ref(base, "binding"), None, "Open", Some("Reopen"), Nil)))).code, "conflict")
    val reopened = run(done.snapshot, List(state("again", ref(base, "binding"), Some(ref(done, "done")), "Open", Some("New investigation requested"), Nil)))
    assertEquals(reopened.snapshot.events.size, 2)
  }

  test("resolving an earlier question contract cannot resolve its revised question") {
    val base = initial(question)
    val revised = run(base.snapshot, List(Operation.Revise("new", ref(base, "definition"), ontology.TestAuthoring.applicability(TestApplicability.unresolved), ontology.TestAuthoring.content(question.copy(text = "Which new evidence is available?")), Standing.Active, List(Target.Exact(ref(base, "definition"))), "Question changed")))
    assertEquals(intercept[Fault](run(revised.snapshot, List(state("done", ref(base, "binding"), None, "Resolved", Some("Old investigation"), Nil)))).code, "stale-context")
  }
}
