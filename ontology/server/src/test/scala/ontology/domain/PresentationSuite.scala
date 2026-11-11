package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.{Authenticated, Digests, Principal, ReviewCall, ServiceCall, TestApplicability, TestAuthoring, TestContexts, Wire}
import java.util.UUID

final class PresentationSuite extends FunSuite {
  private val scope = "presentation-fixture"
  private val at = "2026-11-11T00:00:00Z"
  private val limits = PresentationLimits(8, 32, 1024 * 1024)
  private val human = Actor("reader", ActorKind.Human)
  private def review(actor: Actor, namespace: String): ReviewCall = ReviewCall.from(ServiceCall.authenticated(
    Authenticated(Principal("fixture", actor, Set(namespace), Set(Capability.Read, Capability.Review)), true, "fixture", Some("session")), "/api/v1/present", UUID.randomUUID()), namespace)
  private val call = review(human, scope)
  private def apply(graph: GraphSnapshot, operations: List[Operation]): Applied = {
    val id = UUID.randomUUID()
    new AdmissionEngine().apply(graph, ApplyRequest(scope, id, graph.generation, operations, None), Admission(TestContexts.principal(scope, Actor("author", ActorKind.Agent)), Actor("host", ActorKind.Service), id, at, TestContexts.trace("fixture-apply")))
  }
  private val built = apply(Graph.empty(scope), List(
    Operation.Create("background", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Question("Background", List("X", "Y"), None, Escalation.Unresolved), Nil),
    Operation.Create("question", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Question("Which alternative?", List("A", "B", "B"), None, Escalation.HumanRequired), List(Target.Created("background"))),
    Operation.Bind("binding", Target.Created("question"), Nil, "fixture")))
  private val graph = built.snapshot
  private def ref(alias: String): Ref = built.result.created.find(_.alias == alias).get.ref
  private def prepare(targets: List[Ref]): Presentation = PresentationEngine.prepare(graph, PresentRequest(scope, targets, graph.generation), call, UUID.randomUUID(), at, limits)

  test("preparation preserves the graph and reserves rather than publishes its derived Source") {
    val before = Wire.encode(GraphSnapshot.codecJson, graph)
    val value = prepare(List(ref("question"), ref("binding")))
    assertEquals(Wire.encode(GraphSnapshot.codecJson, graph), before)
    assert(!Graph.exists(graph, value.reservedSourceRef))
    assertEquals(value.payload.generation, graph.generation)
    assertEquals(value.owner, human)
    assertEquals(value.preparationTrace, call.ingress)
    assertEquals(value.payloadDigest, Digests.bytes(PresentationEngine.canonical(value.payload)))
    assert(value.payload.records.exists(record => Graph.recordRef(record) == ref("background")))
    assertEquals(value.payload.manifest.adoptionTargets, List(ref("binding")))
    assertEquals(value.payload.manifest.choices.size, 7)
    assert(!value.payload.manifest.choices.collect { case v: PresentedSelection.Alternative => v.definition }.contains(ref("background")))
    value.payload.manifest.choices.foreach(selection => PresentationEngine.validateAction(value, ReviewAction.Choose(selection), call, limits))
    PresentationEngine.validateAction(value, ReviewAction.Adopt(ref("binding")), call, limits)
  }

  test("exact alternative index label definition and target are all part of selection identity") {
    val value = prepare(List(ref("question")))
    val choice = value.payload.manifest.choices(1).asInstanceOf[PresentedSelection.Alternative]
    assertEquals(choice.label, "B")
    assertEquals(choice.index, 1)
    assertEquals(choice.target, value.reservedSourceRef)
    val wrong = List(choice.copy(index = -1), choice.copy(index = 3), choice.copy(label = "A"), choice.copy(definition = ref("question").copy(revision = 2)), choice.copy(target = ref("question")), choice.copy(definition = ref("background"), index = 0, label = "X"))
    wrong.foreach(selection => assertEquals(intercept[Fault](PresentationEngine.validateAction(value, ReviewAction.Choose(selection), call, limits)).code, "presentation"))
    PresentationEngine.validateAction(value, ReviewAction.Choose(choice.copy(index = 2)), call, limits)
    assertEquals(intercept[Fault](PresentationEngine.validateAction(value, ReviewAction.Adopt(ref("question")), call, limits)).code, "presentation")
  }

  test("later graph changes do not retarget a retained presentation or generic review") {
    val value = prepare(List(ref("question")))
    val updated = apply(graph, List(Operation.Revise("revised", ref("question"), TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Question("New alternatives", List("B", "A"), None, Escalation.Unresolved), Standing.Active, List(Target.Exact(ref("question"))), "Changed after presentation")))
    assert(updated.snapshot.generation > value.payload.generation)
    PresentationEngine.validateAction(value, ReviewAction.Choose(value.payload.manifest.choices(1)), call, limits)
    List(JudgmentKind.Accept, JudgmentKind.RequestCorrection, JudgmentKind.NeedEvidence, JudgmentKind.ReviseIntent).foreach(kind => PresentationEngine.validateAction(value, ReviewAction.Review(kind), call, limits))
    assertEquals(intercept[Fault](PresentationEngine.prepare(updated.snapshot, PresentRequest(scope, List(ref("question")), graph.generation), call, UUID.randomUUID(), at, limits)).code, "conflict")
    assertEquals(intercept[Fault](PresentationEngine.validateAction(value, ReviewAction.Review(JudgmentKind.Accept), review(Actor("other", ActorKind.Human), scope), limits)).code, "forbidden")
    assertEquals(intercept[Fault](PresentationEngine.validateAction(value, ReviewAction.Review(JudgmentKind.Accept), review(human, "other"), limits)).code, "forbidden")
  }

  test("digest, closure and manifest integrity are checked independently") {
    val value = prepare(List(ref("question")))
    val action = ReviewAction.Review(JudgmentKind.NeedEvidence)
    def reseal(payload: PresentationPayload): Presentation = value.copy(payload = payload, payloadDigest = Digests.bytes(PresentationEngine.canonical(payload)))
    val wrong = List(value.copy(payloadDigest = "0" * 64),
      reseal(value.payload.copy(records = value.payload.records.filterNot(record => Graph.recordRef(record) == ref("background")))),
      reseal(value.payload.copy(manifest = value.payload.manifest.copy(adoptionTargets = List(ref("background"))))),
      reseal(value.payload.copy(sourceRefs = List(ref("question")))),
      reseal(value.payload.copy(records = value.payload.records ++ value.payload.records)))
    wrong.foreach(presentation => assertEquals(intercept[Fault](PresentationEngine.validateAction(presentation, action, call, limits)).code, "presentation"))
  }

  test("retained selection validation is independent of a new Human call but preserves preparation identity") {
    val value = prepare(List(ref("question")))
    val action = ReviewAction.Choose(value.payload.manifest.choices(1))
    PresentationEngine.validateSelection(value, action, limits)
    List(value.copy(owner = Actor("agent", ActorKind.Agent)),
      value.copy(preparationTrace = value.preparationTrace.copy(transport = RequestTransport.Bearer)),
      value.copy(createdAt = "not-a-time"), value.copy(reservedSourceRef = Ref(UUID.randomUUID(), 1))).foreach { invalid =>
      assertEquals(intercept[Fault](PresentationEngine.validateSelection(invalid, action, limits)).code, "presentation")
    }
  }

  test("preparation bounds reject rather than truncate exact context") {
    val request = PresentRequest(scope, List(ref("question")), graph.generation)
    List(PresentationLimits(1, 1, 1024 * 1024), PresentationLimits(1, 32, 1)).foreach(cap =>
      assertEquals(intercept[Fault](PresentationEngine.prepare(graph, request, call, UUID.randomUUID(), at, cap)).code, "presentation"))
    List(Nil, List(ref("question"), ref("question")), List(Ref(UUID.randomUUID(), 1))).foreach(targets =>
      assertEquals(intercept[Fault](prepare(targets)).code, "presentation"))
    val id = UUID.randomUUID()
    val collision = graph.definitions.head.copy(ref = PresentationEngine.reservedRef(id))
    assertEquals(intercept[Fault](PresentationEngine.prepare(graph.copy(definitions = graph.definitions :+ collision), request, call, id, at, limits)).code, "presentation")
  }
}
