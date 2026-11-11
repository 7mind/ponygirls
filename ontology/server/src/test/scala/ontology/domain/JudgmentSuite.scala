package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.{Authenticated, Digests, Principal, ReviewCall, ServiceCall, TestApplicability, TestAuthoring, TestContexts, Wire}
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

final class JudgmentSuite extends FunSuite {
  private val scope = "judgment-fixture"
  private val at = "2026-11-11T00:00:00Z"
  private val later = "2026-11-11T01:00:00Z"
  private val limits = ReviewLimits(PresentationLimits(8, 32, 1024 * 1024), 4096, 8192)
  private val engine = new JudgmentEngine(limits)
  private val human = Actor("reader", ActorKind.Human)
  private val service = Actor("review-service", ActorKind.Service)
  private def call(namespace: String, operation: String): ReviewCall = ReviewCall.from(ServiceCall.authenticated(
    Authenticated(Principal(namespace, human, Set(scope), Set(Capability.Read, Capability.Review)), true, "fixture", Some("session")), operation, UUID.randomUUID()), scope)
  private val originalCall = call("first-credential", "/api/v1/judge")
  private val preparationCall = call("first-credential", "/api/v1/present")
  private val id = UUID.randomUUID()
  private val created = new AdmissionEngine().apply(Graph.empty(scope), ApplyRequest(scope, id, 0L, List(
    Operation.Create("q", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Question("Which?", List("A", "B"), None, Escalation.HumanRequired), Nil),
    Operation.Bind("b", Target.Created("q"), Nil, "fixture")), None),
    Admission(TestContexts.principal(scope, Actor("author", ActorKind.Agent)), service, id, at, TestContexts.trace("fixture-apply"), Nil))
  private val graph = created.snapshot
  private def ref(alias: String): Ref = created.result.created.find(_.alias == alias).get.ref
  private def presentation(target: Ref): Presentation = PresentationEngine.prepare(graph, PresentRequest(scope, List(target), graph.generation), preparationCall, UUID.randomUUID(), at, limits.presentation)
  private def request(p: Presentation, action: ReviewAction): JudgmentRequest = JudgmentRequest(scope, UUID.randomUUID(), p.id, action, "Explicit controlled account, not execution permission")

  test("generic reviews publish separate derived and actual sources but no adoption selection or work result") {
    val p = presentation(ref("q"))
    List(JudgmentKind.Accept, JudgmentKind.RequestCorrection, JudgmentKind.NeedEvidence, JudgmentKind.ReviseIntent).foreach { kind =>
      val input = request(p, ReviewAction.Review(kind))
      val result = engine(graph, p, input, originalCall, service, later, None)
      val derived = Graph.node(result.snapshot, p.reservedSourceRef)
      val actual = Graph.node(result.snapshot, result.judgment.source)
      assertEquals(result.snapshot.generation, graph.generation + 1L)
      assertEquals(result.snapshot.sourceFrontier, graph.sourceFrontier + 1L)
      assertEquals(result.snapshot.coveredFrontier, graph.coveredFrontier)
      assertEquals(result.snapshot.selections, graph.selections)
      assertEquals(result.snapshot.events, graph.events)
      assertEquals(result.snapshot.relations, graph.relations)
      assertEquals(result.relation, None)
      assertEquals(derived.provenance.contributor, service)
      assertEquals(actual.provenance.contributor, human)
      val data = derived.content.asInstanceOf[Content.Source]
      assertEquals(data.text, new String(PresentationEngine.canonical(p.payload), UTF_8))
      assertEquals(data.rawDigest, Digests.text(data.text))
      val descriptor = data.descriptor.asInstanceOf[SourceDescriptor.DerivedPresentation]
      assertEquals(descriptor.generation, p.payload.generation)
      assertEquals(descriptor.preparedAt, p.createdAt)
      assertEquals(derived.provenance.recordedAt, later)
      assertEquals(result.event.metadata.representation, SourceRepresentation.HumanJudgment)
      assertEquals(result.event.reviewResponse.get.presentationSource, p.reservedSourceRef)
      assertEquals(result.event.context, Contexts.server(originalCall.ingress, Contexts.ProtocolLimits))
      assertEquals(result.event.text, Wire.encode(JudgmentRequest.codecJson, input).noSpaces)
      assertEquals(result.receipt.kind, InputKind.Judgment)
      assertEquals(result.publicationReceipt.get.kind, InputKind.PresentationPublication)
      assertEquals(Contexts.nativeOption(result.event.context), None)
    }
  }

  test("explicit choice and adoption publish exact captured-action edges without selecting a binding") {
    val p = presentation(ref("q"))
    val choice = p.payload.manifest.choices(1)
    val selected = engine(graph, p, request(p, ReviewAction.Choose(choice)), originalCall, service, later, None)
    val edge = selected.relation.get
    assertEquals(edge.kind, RelationKind.Chooses)
    assertEquals(edge.sources, List(selected.judgment.source))
    assertEquals(edge.targets, List(p.reservedSourceRef))
    assertEquals(edge.detail, RelationDetail.Adoption(p.id, AdoptionOrigin.CapturedAction, selected.judgment.source, choice))
    val bound = presentation(ref("b"))
    val adopted = engine(graph, bound, request(bound, ReviewAction.Adopt(ref("b"))), originalCall, service, later, None)
    assertEquals(adopted.relation.get.kind, RelationKind.Adopts)
    assertEquals(adopted.relation.get.targets, List(ref("b")))
    assertEquals(adopted.snapshot.selections, Nil)
    assertEquals(adopted.snapshot.events, Nil)
  }

  test("a later distinct action reuses the original derived publication unchanged") {
    val p = presentation(ref("q"))
    val firstInput = request(p, ReviewAction.Review(JudgmentKind.Accept))
    val first = engine(graph, p, firstInput, originalCall, service, at, None)
    val nextCall = call("rotated-credential", "/api/v1/judge")
    val second = engine(first.snapshot, p, request(p, ReviewAction.Review(JudgmentKind.NeedEvidence)), nextCall, Actor("service-v2", ActorKind.Service), later, first.publicationReceipt)
    assertEquals(second.publicationReceipt, None)
    assertEquals(Graph.node(second.snapshot, p.reservedSourceRef), Graph.node(first.snapshot, p.reservedSourceRef))
    assertEquals(second.snapshot.definitions.count(_.ref == p.reservedSourceRef), 1)
    assertEquals(second.event.sourceNamespace, "rotated-credential")
    assertEquals(second.snapshot.sourceFrontier, first.snapshot.sourceFrontier + 1L)
    assertEquals(second.receipt.ingress, nextCall.ingress)
    assert(first.judgment.source != CaptureIdentity.source(originalCall.principal.credentialId, firstInput.requestId))
    assertEquals(first.judgment.input, ReviewIdentity.input(originalCall.principal.credentialId, firstInput.requestId))
    assertEquals(intercept[Fault](engine(first.snapshot, p, firstInput, nextCall, service, later, first.publicationReceipt)).code, "identity")
  }

  test("future-relative presentations reject while genuinely historical presentations remain valid") {
    val updateId = UUID.randomUUID()
    val update = ApplyRequest(scope, updateId, graph.generation, List(Operation.Create("unrelated", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Unrelated later record", Modality.Assertion), Nil)), None)
    val advanced = new AdmissionEngine().apply(graph, update, Admission(TestContexts.principal(scope, Actor("author", ActorKind.Agent)), service, updateId, at, TestContexts.trace("fixture-apply"), Nil)).snapshot
    val future = PresentationEngine.prepare(advanced, PresentRequest(scope, List(ref("q")), advanced.generation), preparationCall, UUID.randomUUID(), at, limits.presentation)
    assert(future.payload.records.forall(Graph.records(graph).contains))
    assertEquals(intercept[Fault](engine(graph, future, request(future, ReviewAction.Review(JudgmentKind.Accept)), originalCall, service, later, None)).code, "presentation")
    val historical = presentation(ref("q"))
    val result = engine(advanced, historical, request(historical, ReviewAction.Review(JudgmentKind.Accept)), originalCall, service, later, None)
    assertEquals(result.snapshot.generation, advanced.generation + 1L)
    assertEquals(result.publicationReceipt.get.generation, result.snapshot.generation)
  }

  test("derived publication corruption is rejected rather than overwritten or republished") {
    val p = presentation(ref("q"))
    val first = engine(graph, p, request(p, ReviewAction.Review(JudgmentKind.Accept)), originalCall, service, at, None)
    val original = Graph.node(first.snapshot, p.reservedSourceRef)
    val content = original.content.asInstanceOf[Content.Source]
    val descriptor = content.descriptor.asInstanceOf[SourceDescriptor.DerivedPresentation]
    val altered = List(original.copy(content = content.copy(text = "changed")),
      original.copy(content = content.copy(descriptor = descriptor.copy(preparedAt = later))),
      original.copy(provenance = original.provenance.copy(contributor = human)), original.copy(ref = original.ref.copy(revision = 2)))
    val input = request(p, ReviewAction.Review(JudgmentKind.NeedEvidence))
    altered.foreach { node =>
      val broken = first.snapshot.copy(definitions = first.snapshot.definitions.map(value => if (value.ref == original.ref) node else value))
      assertEquals(intercept[Fault](engine(broken, p, input, originalCall, service, later, first.publicationReceipt)).code, "corrupt")
    }
    assertEquals(intercept[Fault](engine(first.snapshot, p, input, originalCall, service, later, None)).code, "corrupt")
    assertEquals(intercept[Fault](engine(graph, p, input, originalCall, service, later, first.publicationReceipt)).code, "corrupt")
    val receipt = first.publicationReceipt.get
    List(receipt.copy(content = "{}"), receipt.copy(ingress = TestContexts.trace("new-ingress")), receipt.copy(contributor = human)).foreach { invalid =>
      assertEquals(intercept[Fault](engine(first.snapshot, p, input, originalCall, service, later, Some(invalid))).code, "corrupt")
    }
  }
}
