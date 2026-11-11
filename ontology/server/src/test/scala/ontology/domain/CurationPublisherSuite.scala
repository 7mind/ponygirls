package ontology.domain

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID
import munit.FunSuite
import ontology.{Digests, Principal, StoredJson, TestContexts, Wire}
import ontology.api.*
import ontology.curation.CurationInputs

final class CurationPublisherSuite extends FunSuite {
  private val at = Instant.parse("2026-11-11T00:00:00Z")
  private val scope = "curation-publication"
  private val limits = CurationGuardLimits(3, 65536, 1048576L, 128, 128)
  private val engine = new AdmissionEngine
  private val publisher = new CurationPublisher(engine, limits)
  private val service = Actor("fixture-service", ActorKind.Service)
  private val curator = Principal("curator-profile", Actor("curator", ActorKind.Agent), Set(scope), Set(Capability.Read, Capability.Mutate))
  private val trace = RequestTrace(UUID.randomUUID(), CurationIdentity.Operation, RequestTransport.Internal)
  private val collector = Principal("fixture-capture", Actor("collector", ActorKind.Collector), Set(scope), Set(Capability.Capture))
  private val captured = new CaptureEngine().apply(Graph.empty(scope), Nil, 0L,
    IngestRequest(scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
      CaptureMetadata("fixture", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "Controlled source", Observation.None()),
    collector, service, at.toString, TestContexts.trace("fixture"))
  private val graph = captured.snapshot
  private val sources = List(captured.event)
  private val fence = CoordinatorFence(UUID.randomUUID(), 1L)
  private val lease = CoordinatorLease(fence, at.toString, at.toString, at.plusSeconds(60).toString)
  private val claim = CurationClaim(UUID.randomUUID(), scope, fence, graph.generation, graph.sourceFrontier, graph.coveredFrontier, limits.toWire, "fixture",
    "a" * 64, "b" * 64, CurationMaterial.graphDigest(graph), CurationMaterial.sourceDigest(sources), at.toString)
  private val material = CurationMaterial.seal(claim, graph, sources, at.plusSeconds(1), limits)
  private def payload(json: Json): CurationAuditPayload = {
    val text = json.noSpaces
    CurationAuditPayload(CurationJournal.JsonEncoding, text, Digests.text(text), text.getBytes(UTF_8).length.toLong)
  }
  private final case class ProposalFixture(attempt: CurationAttempt, entries: List[CurationAuditRecord], candidate: CurationCandidate)
  private def proposed(operations: List[Operation]): ProposalFixture = {
    val request = payload(Json.obj("messages" -> Json.arr(
      Json.obj("role" -> Json.fromString("system"), "content" -> Json.fromString("Controlled policy")),
      Json.obj("role" -> Json.fromString("user"), "content" -> Json.fromString(CurationInputs.json(material.input).noSpaces)))))
    val proposal = CurationProposal(graph.generation, graph.sourceFrontier, operations)
    val response = payload(Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj(
      "role" -> Json.fromString("assistant"), "content" -> Json.fromString(StoredJson.encode(CurationProposal.codecJson, proposal)))))))
    val entries = List(
      CurationAuditRecord(claim.attemptId, scope, fence, 1, CurationAuditStage.RequestPrepared, request.digest, Some(request), at.plusSeconds(2).toString),
      CurationAuditRecord(claim.attemptId, scope, fence, 1, CurationAuditStage.DispatchPossible, request.digest, None, at.plusSeconds(3).toString),
      CurationAuditRecord(claim.attemptId, scope, fence, 1, CurationAuditStage.ResponseObserved, request.digest, Some(response), at.plusSeconds(4).toString))
    val candidate = CurationCandidate(claim.attemptId, material.manifest.inputDigest, 1, response.digest, proposal, Digests.text(Wire.encode(CurationProposal.codecJson, proposal).noSpaces))
    ProposalFixture(CurationAttempt(claim, CurationAttemptState.Running, Some(material.manifest), None, None, None, false, None), entries, candidate)
  }
  private def publish(value: ProposalFixture): PublishedCuration = publisher.publish(graph, value.attempt, value.entries, value.candidate,
    sources, lease, curator, service, service, trace, at.plusSeconds(5), Nil)
  private val create = Operation.Create("summary", ApplicabilityInput.Unresolved("Controlled interpretation", Nil, Nil),
    ContentInput.Statement("A proposed interpretation, not a verified fact", Modality.Assertion), List(Target.Exact(Ref(captured.event.id, 1))))

  test("empty curation advances only graph generation and coverage while retaining a maintenance receipt") {
    val value = proposed(Nil)
    val result = publish(value)
    assertEquals(result.snapshot, graph.copy(generation = graph.generation + 1L, coveredFrontier = graph.sourceFrontier))
    assertEquals(result.receipt.kind, InputKind.Curation)
    assertEquals(result.receipt.ref, CurationIdentity.input(scope, claim.attemptId))
    assertEquals(result.attempt.state, CurationAttemptState.Published)
    assertEquals(result.attempt.publication, Some(result.publication))
    assertEquals(result.attempt.candidate, Some(value.candidate))
    InputReceipts.validateContext(result.receipt)
    CurationGuards.validate(result.attempt, value.entries, limits)
    SourceIntegrity.frontier(result.snapshot, sources)
  }

  test("a Published attempt cannot point to a different maintenance input receipt") {
    val value = proposed(Nil)
    val result = publish(value)
    val different = result.publication.copy(input = Ref(UUID.randomUUID(), 1))
    assertEquals(intercept[Fault](CurationGuards.validate(result.attempt.copy(publication = Some(different)), value.entries, limits)).code, "curation")
  }

  test("nonempty curation acquires Curation provenance during ordinary semantic admission") {
    val result = publish(proposed(List(create)))
    val added = result.snapshot.definitions.drop(graph.definitions.size)
    assertEquals(added.size, 1)
    assertEquals(added.head.ref, CurationIdentity.record(scope, claim.attemptId, "summary"))
    assertEquals(added.head.provenance, Provenance(curator.actor, service, result.receipt.ref.id, at.plusSeconds(5).toString))
    assertEquals(result.snapshot.sourceFrontier, graph.sourceFrontier)
    assertEquals(result.snapshot.coveredFrontier, graph.sourceFrontier)
    val retained = StoredJson.decode(CurationPublicationInput.codecJson, result.receipt.content)
    assertEquals(retained.proposal.operations, List(create))
    assertEquals(result.receipt.contributionContext, Contexts.server(trace, Contexts.ProtocolLimits))
    SourceIntegrity.frontier(result.snapshot, sources)
  }

  test("ordinary command identities and source-trigger behavior remain distinct and unchanged") {
    val admission = Admission(curator, service, claim.attemptId, at.plusSeconds(5).toString, TestContexts.trace("ordinary-apply"), Nil)
    val request = ApplyRequest(scope, claim.attemptId, graph.generation, List(create), None)
    val ordinary = engine(graph, request, admission)
    val curated = publish(proposed(List(create)))
    val ordinaryRecord = ordinary.snapshot.definitions.last
    assertEquals(ordinaryRecord.ref, admission.ref("summary"))
    assertEquals(ordinaryRecord.provenance.input, InputReceipts.graphId(curator.actor, claim.attemptId))
    assert(ordinaryRecord.ref != curated.snapshot.definitions.last.ref)
    assert(ordinaryRecord.provenance.input != curated.receipt.ref.id)
    assertEquals(ordinary.snapshot.sourceFrontier, graph.sourceFrontier)
    assertEquals(ordinary.snapshot.coveredFrontier, graph.coveredFrontier)
    assertEquals(intercept[Fault](engine(graph, request.copy(operations = Nil), admission)).code, "operations")
  }

  test("a late protected mutation cannot return a partial publication or rewrite captured evidence") {
    val source = Ref(captured.event.id, 1)
    val revise = Operation.Revise("rewriteSource", source, ApplicabilityInput.Unresolved("Controlled rejection", Nil, Nil),
      ContentInput.Statement("Not captured text", Modality.Assertion), Standing.Active, List(Target.Exact(source)), "Controlled rejection")
    val value = proposed(List(create, revise))
    assertEquals(intercept[Fault](publish(value)).code, "protected")
    assertEquals(graph, captured.snapshot)
    assertEquals(Graph.node(graph, source).content.asInstanceOf[Content.Source].text, captured.event.text)
    assertEquals(value.attempt.state, CurationAttemptState.Running)
    assertEquals(value.attempt.publication, None)
  }

  test("coverage-only publication cannot bypass stale-head and lease checks") {
    val value = proposed(Nil)
    assertEquals(intercept[Fault](publisher.publish(graph.copy(generation = graph.generation + 1L), value.attempt, value.entries, value.candidate,
      sources, lease, curator, service, service, trace, at.plusSeconds(5), Nil)).code, "curation-stale")
    assertEquals(intercept[Fault](publisher.publish(graph, value.attempt, value.entries, value.candidate,
      sources, lease, curator, service, service, trace, at.plusSeconds(60), Nil)).code, "curation")
  }

  test("empty maintenance still requires scoped Read and Mutate grants and internal agent/service attribution") {
    val value = proposed(Nil)
    def attempt(principal: Principal, recorder: Actor, submitter: Actor, ingress: RequestTrace): PublishedCuration =
      publisher.publish(graph, value.attempt, value.entries, value.candidate, sources, lease, principal, recorder, submitter, ingress, at.plusSeconds(5), Nil)
    val ungranted = List(curator.copy(scopes = Set("elsewhere")), curator.copy(capabilities = Set(Capability.Read)), curator.copy(capabilities = Set(Capability.Mutate)))
    ungranted.foreach(principal => assertEquals(intercept[Fault](attempt(principal, service, service, trace)).code, "forbidden"))
    assertEquals(intercept[Fault](attempt(curator.copy(actor = Actor("not-an-agent", ActorKind.Human)), service, service, trace)).code, "curation")
    assertEquals(intercept[Fault](attempt(curator, curator.actor, service, trace)).code, "curation")
    assertEquals(intercept[Fault](attempt(curator, service, curator.actor, trace)).code, "curation")
    assertEquals(intercept[Fault](attempt(curator, service, service, trace.copy(transport = RequestTransport.Bearer))).code, "curation")
    assertEquals(intercept[Fault](attempt(curator, service, service, trace.copy(operation = "other"))).code, "curation")
  }
}

