package ontology

import java.util.UUID
import munit.FunSuite
import ontology.api.*
import ontology.domain.*

final class GraphCommandEngineSuite extends FunSuite {
  private def request: ApplyRequest = ApplyRequest("command-fixture", UUID.randomUUID(), 0L, List(
    Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Untrusted command account", Modality.Assertion), Nil)),
    Some(TestContexts.claim(CaptureContext("reported-session", None, None, LineageStatus.Unknown, "reported-branch", UUID.randomUUID()))))
  private def admission(r: ApplyRequest): Admission = Admission(TestContexts.principal(r.scope, Actor("command-agent", ActorKind.Agent)),
    Actor("command-service", ActorKind.Service), r.requestId, "2026-11-11T00:00:00Z", TestContexts.trace("command"), Nil)

  test("command wrapper publishes one generation and frontier while shared admission remains frontier-neutral") {
    val r = request; val a = admission(r); val base = Graph.empty(r.scope)
    val engine = new AdmissionEngine
    val ordinary = engine(base, r, a)
    val command = new GraphCommandEngine(engine)(base, r, a)
    assertEquals(ordinary.snapshot.sourceFrontier, 0L)
    assertEquals(command.snapshot.generation, 1L)
    assertEquals(command.snapshot.sourceFrontier, 1L)
    assertEquals(command.snapshot.coveredFrontier, 0L)
    assertEquals(command.result, ordinary.result)
    assertEquals(command.event.context, Contexts.server(a.ingress, Contexts.ProtocolLimits))
    assertEquals(command.receipt.contributionContext, Contexts.contribution(r.contributionContext, a.ingress, Contexts.ProtocolLimits))
    assert(command.event.context != command.receipt.contributionContext)
    assertEquals(command.event.text, command.receipt.content)
    assertEquals(StoredJson.decode(ApplyRequest.codecJson, command.event.text), r)
    assertEquals(command.receipt.ref.id, a.provenance.input)
    assertEquals(command.result.created, GraphCommandIdentity.created(r))
    val source = Graph.node(command.snapshot, Ref(command.event.id, 1)).content.asInstanceOf[Content.Source]
    assertEquals(source.context, command.result.created.map(_.ref))
    assertEquals(source.rawDigest, command.receipt.digest)
    assertEquals(command.event.origin, EventOrigin.GraphCommand)
    SourceIntegrity.frontier(command.snapshot, List(command.event))
  }
  test("command identities are disjoint and do not depend on credential rotation") {
    val r = request; val a = admission(r)
    val engine = new GraphCommandEngine(new AdmissionEngine)
    val first = engine(Graph.empty(r.scope), r, a)
    val second = engine(Graph.empty(r.scope), r, a.copy(principal = a.principal.copy(credentialId = "rotated")))
    assertEquals(first, second)
    assert(first.event.id != first.receipt.ref.id)
    assert(!first.result.created.exists(_.ref.id == first.event.id))
    assert(first.event.id != CaptureIdentity.event(first.event.sourceNamespace, r.requestId))
    assert(GraphCommandIdentity.source(r.scope, a.actor, r.requestId) != GraphCommandIdentity.source(r.scope + "-other", a.actor, r.requestId))
  }
  test("retained command validation rejects altered result, receipt and occurrence correspondence") {
    val r = request; val a = admission(r)
    val command = new GraphCommandEngine(new AdmissionEngine)(Graph.empty(r.scope), r, a)
    def rejected(event: CapturedEvent, result: ApplyResult, receipt: InputReceipt): Unit =
      assertEquals(intercept[Fault](GraphCommandIntegrity.validate(command.snapshot, event, result, receipt, Graph.empty(r.scope), Nil, new AdmissionEngine)).code, "corrupt")
    rejected(command.event, command.result.copy(created = Nil), command.receipt)
    rejected(command.event.copy(context = command.receipt.contributionContext), command.result, command.receipt)
    rejected(command.event, command.result, command.receipt.copy(generation = 2L))
    rejected(command.event, command.result, command.receipt.copy(submitter = Actor("other", ActorKind.Agent)))
    rejected(command.event.copy(text = "substituted command"), command.result, command.receipt)
  }
  for (extra <- List(false, true)) test(s"command correspondence rejects changed or extra attributed output: extra=$extra") {
    val r = request; val a = admission(r)
    val command = new GraphCommandEngine(new AdmissionEngine)(Graph.empty(r.scope), r, a)
    val original = Graph.node(command.snapshot, command.result.created.head.ref)
    val altered = if (extra) command.snapshot.copy(definitions = command.snapshot.definitions :+ original.copy(ref = Ref(UUID.randomUUID(), 1)))
      else command.snapshot.copy(definitions = command.snapshot.definitions.map(value => if (value.ref == original.ref)
        value.copy(content = Content.Statement("Different command output", Modality.Assertion)) else value))
    assertEquals(intercept[Fault](GraphCommandIntegrity.validate(altered, command.event, command.result, command.receipt, Graph.empty(r.scope), Nil, new AdmissionEngine)).code, "corrupt")
  }
  for (relabel <- List(false, true)) test(s"later cuts retain exact command-introduced actors: relabel=$relabel") {
    val r = request; val a = admission(r)
    val command = new GraphCommandEngine(new AdmissionEngine)(Graph.empty(r.scope), r, a)
    val principal = Principal("capturer", Actor("capturer", ActorKind.Agent), Set(r.scope), Set(Capability.Capture))
    val input = IngestRequest(r.scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.WorkerMessage,
      CaptureMetadata("later", None, None, SourceRepresentation.Text, Nil, Nil), "Later captured account", Observation.None())
    val later = new CaptureEngine().apply(command.snapshot, List(command.event), command.snapshot.sourceFrontier, input, principal, a.recorder,
      "2026-11-11T00:01:00Z", TestContexts.trace("capture")).snapshot
    val actors = if (relabel) later.actors.map(value => if (value.value == a.actor) value.copy(value = a.actor.copy(id = "relabeled")) else value)
      else later.actors.filterNot(_.value == a.actor)
    assertEquals(intercept[Fault](GraphCommandIntegrity.validate(later.copy(actors = actors), command.event, command.result, command.receipt,
      Graph.empty(r.scope), Nil, new AdmissionEngine)).code, "corrupt")
  }
  test("public capture cannot manufacture primary command activity for any principal kind") {
    ActorKind.all.foreach { kind =>
      val r = request
      val principal = Principal("capture-test", Actor("capture-test", kind), Set(r.scope), Set(Capability.Capture, Capability.HostCapture))
      val input = IngestRequest(r.scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.GraphCommand,
        CaptureMetadata("command", None, None, SourceRepresentation.GraphCommand, Nil, Nil), "not a repository command", Observation.None())
      assertEquals(intercept[Fault](new CaptureEngine().validateIngress(input, principal)).code, "capture-origin")
    }
  }
}
