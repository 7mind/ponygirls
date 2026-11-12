package ontology

import io.circe.Json
import java.time.Instant
import java.util.UUID
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import ontology.curation.CurationInputs

final class CurationReadModelSuite extends FunSuite {
  private val at = Instant.parse("2026-11-11T00:00:00Z")
  private val limits = CurationGuardLimits(3, 65536, 1048576L, 128, 128)
  private val service = Actor("fixture-service", ActorKind.Service)
  private val collector = Principal("fixture-collector", Actor("fixture-collector", ActorKind.Collector), Set("s"), Set(Capability.Capture))
  private val captured = new CaptureEngine().apply(Graph.empty("s"), Nil, 0L,
    IngestRequest("s", UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
      CaptureMetadata("fixture", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "Controlled source", Observation.None()),
    collector, service, at.toString, TestContexts.trace("capture"))
  private val graph = captured.snapshot
  private val sources = List(captured.event)
  private val fence = CoordinatorFence(UUID.randomUUID(), 1L)
  private val lease = CoordinatorLease(fence, at.toString, at.toString, at.plusSeconds(60).toString)
  private val claim = CurationClaim(UUID.randomUUID(), "s", fence, graph.generation, graph.sourceFrontier, graph.coveredFrontier, limits.toWire,
    "fixture", "a" * 64, "b" * 64, CurationMaterial.graphDigest(graph), CurationMaterial.sourceDigest(sources), at.toString, at.plusSeconds(120).toString)
  private val claimed = CurationAttempt(claim, CurationAttemptState.Claimed, None, None, None, None, false, None)
  private val material = CurationMaterial.seal(claim, graph, sources, at, limits)
  private val sealedAttempt = CurationGuards.seal(claimed, Nil, graph, sources, lease, at, limits)
  private def payload(value: Json): CurationAuditPayload = {
    val text = value.noSpaces
    CurationAuditPayload("application/json", text, Digests.text(text), text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length.toLong)
  }
  private val request = payload(Json.obj("messages" -> Json.arr(
    Json.obj("role" -> Json.fromString("system"), "content" -> Json.fromString("Controlled policy")),
    Json.obj("role" -> Json.fromString("user"), "content" -> Json.fromString(CurationInputs.json(material.input).noSpaces)))))
  private val prepared = CurationGuards.append(sealedAttempt, Nil, 1, CurationAuditStage.RequestPrepared, request.digest, Some(request), lease, at, limits)
  private val dispatched = CurationGuards.append(prepared.attempt, prepared.entries, 1, CurationAuditStage.DispatchPossible, request.digest, None, lease, at, limits)
  private val proposal = CurationProposal(graph.generation, graph.sourceFrontier, Nil)
  private val response = payload(Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj(
    "role" -> Json.fromString("assistant"), "content" -> Json.fromString(Wire.encode(CurationProposal.codecJson, proposal).noSpaces))))))
  private val observed = CurationGuards.append(dispatched.attempt, dispatched.entries, 1, CurationAuditStage.ResponseObserved, request.digest, Some(response), lease, at, limits)
  private val candidate = CurationCandidate(claim.attemptId, material.manifest.inputDigest, 1, response.digest, proposal, Digests.text(Wire.encode(CurationProposal.codecJson, proposal).noSpaces))
  private val engine = new AdmissionEngine
  private val published = new CurationPublisher(engine, limits).publish(graph, observed.attempt, observed.entries, candidate, sources, lease,
    TestContexts.principal("s", Actor("curator", ActorKind.Agent)), service, service, RequestTrace(UUID.randomUUID(), CurationIdentity.Operation, RequestTransport.Internal), at, Nil)
  private val reads = new CurationReadModel(new CurationValidation(engine))
  private val completed = CurationAttemptView(published.attempt, observed.entries)
  private val cut = CapsuleCut(graph.generation, graph.sourceFrontier, graph.coveredFrontier, None, Some(reads.summary(CurationAttemptView(prepared.attempt, prepared.entries))))
  private val publishedCut = CapsuleCut(published.snapshot.generation, published.snapshot.sourceFrontier, published.snapshot.coveredFrontier,
    Some(published.publication.generation), Some(reads.summary(completed)))
  private final class FixtureRead(view: CurationAttemptView) extends CurationReadContext {
    def head(scope: String): GraphSnapshot = { assertEquals(scope, "s"); published.snapshot }
    def history(scope: String, generation: Long): GraphSnapshot = {
      assertEquals(scope, "s")
      Map(0L -> Graph.empty("s"), graph.generation -> graph, published.snapshot.generation -> published.snapshot)
        .getOrElse(generation, throw Fault("not-found", "fixture history missing"))
    }
    def sources(snapshot: GraphSnapshot, after: Long): List[CapturedEvent] = CurationReadModelSuite.this.sources.filter(e => e.frontier > after && e.frontier <= snapshot.sourceFrontier)
    def input(scope: String, ref: Ref): InputReceipt = {
      assertEquals(scope, "s")
      List(captured.receipt, published.receipt).find(_.ref == ref).getOrElse(throw Fault("not-found", "fixture input missing"))
    }
    def reviewEvidence(snapshot: GraphSnapshot, request: ApplyRequest): List[ReviewEvidence] = {
      assertEquals(Adoptions.claims(request), Nil); Nil
    }
    def publications(scope: String, throughGeneration: Long): List[CurationAttemptView] = {
      assertEquals(scope, "s")
      List(view).filter(_.attempt.publication.exists(_.generation <= throughGeneration))
    }
    def find(scope: String, id: UUID): Option[CurationAttemptView] = Option.when(scope == "s" && id == view.attempt.claim.attemptId)(view)
    def latest(scope: String, publishedOnly: Boolean): Option[CurationAttemptView] = {
      assertEquals(scope, "s"); Option.when(!publishedOnly || view.attempt.state == CurationAttemptState.Published)(view)
    }
  }
  private val stored = new FixtureRead(completed)

  test("current graph and status come from one read context") {
    val current = reads.current(stored, "s")
    assertEquals(current.snapshot, published.snapshot)
    assertEquals(CapsuleContext.cut(current.status), publishedCut)
    assertEquals(current.status.state, CurationState.Idle)
  }
  test("earlier active prefixes survive publication at the same timestamp") {
    List(CurationAttemptView(claimed, Nil), CurationAttemptView(sealedAttempt, Nil), CurationAttemptView(prepared.attempt, prepared.entries),
      CurationAttemptView(dispatched.attempt, dispatched.entries)).foreach { prior =>
      val retained = cut.copy(attempt = Some(reads.summary(prior)))
      assertEquals(reads.retainedCut(stored, "s", retained, at), graph)
    }
  }
  test("earlier prefixes and exact terminal observations survive same-time failure outcomes") {
    List(CurationAttemptState.Failed, CurationAttemptState.Stale, CurationAttemptState.Interrupted).foreach { state =>
      val stopped = CurationGuards.terminate(observed.attempt, observed.entries, state, "fixture-stop", at, limits)
      val view = CurationAttemptView(stopped, observed.entries)
      val read = new FixtureRead(view)
      assertEquals(reads.retainedCut(read, "s", cut, at), graph)
      assertEquals(reads.retainedCut(read, "s", cut.copy(attempt = Some(reads.summary(view))), at), graph)
    }
  }
  test("historical publication remains valid after its deadline") {
    assertEquals(reads.retainedCut(stored, "s", publishedCut, at.plusSeconds(1000)), published.snapshot)
  }
  test("wrong immutable header and publication cut cannot be substituted") {
    List(cut.copy(frontier = cut.frontier + 1L), cut.copy(coveredFrontier = 1L), cut.copy(lastPublicationGeneration = Some(1L)),
      publishedCut.copy(lastPublicationGeneration = None), publishedCut.copy(attempt = None), publishedCut.copy(attempt = cut.attempt)).foreach { value =>
      assertEquals(intercept[Fault](reads.retainedCut(stored, "s", value, at)).code, "corrupt")
    }
  }
  test("observed endpoint uncertainty phase and copied claim coordinates are checked") {
    val summary = cut.attempt.get
    List(summary.copy(baseGeneration = 0L), summary.copy(deadlineAt = at.plusSeconds(121).toString), summary.copy(inputDigest = Some("f" * 64)),
      summary.copy(lastOrdinal = Some(2)), summary.copy(lastStage = None), summary.copy(auditUncertain = true),
      summary.copy(state = CurationAttemptState.Claimed), summary.copy(state = CurationAttemptState.Failed, terminalCode = Some("failed"), finishedAt = Some(at.toString))).foreach { value =>
      assertEquals(intercept[Fault](reads.retainedCut(stored, "s", cut.copy(attempt = Some(value)), at)).code, "corrupt")
    }
  }
  test("positive evidence cannot postdate its observation") {
    assertEquals(intercept[Fault](reads.retainedCut(stored, "s", cut, at.minusNanos(1))).code, "corrupt")
  }
  test("a newer claim cannot hide a publication timestamp ahead of the observation") {
    val later = new CaptureEngine().apply(published.snapshot, sources, published.snapshot.sourceFrontier,
      IngestRequest("s", UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
        CaptureMetadata("later", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "Later source under regressed clock", Observation.None()),
      collector, service, at.minusSeconds(2).toString, TestContexts.trace("capture"))
    val nextClaim = claim.copy(attemptId = UUID.randomUUID(), fence = fence.copy(epoch = 2L), baseGeneration = later.snapshot.generation,
      frontier = later.snapshot.sourceFrontier, previousCoveredFrontier = later.snapshot.coveredFrontier,
      graphDigest = CurationMaterial.graphDigest(later.snapshot), sourceCutDigest = CurationMaterial.sourceDigest(List(later.event)), claimedAt = at.minusSeconds(1).toString)
    val next = CurationAttemptView(claimed.copy(claim = nextClaim), Nil)
    val read = new CurationReadContext {
      def head(scope: String): GraphSnapshot = later.snapshot
      def history(scope: String, generation: Long): GraphSnapshot = if (generation == later.snapshot.generation) later.snapshot else stored.history(scope, generation)
      def sources(snapshot: GraphSnapshot, after: Long): List[CapturedEvent] = (CurationReadModelSuite.this.sources :+ later.event).filter(e => e.frontier > after && e.frontier <= snapshot.sourceFrontier)
      def input(scope: String, ref: Ref): InputReceipt = if (ref == later.receipt.ref) later.receipt else stored.input(scope, ref)
      def reviewEvidence(snapshot: GraphSnapshot, request: ApplyRequest): List[ReviewEvidence] = stored.reviewEvidence(snapshot, request)
      def publications(scope: String, throughGeneration: Long): List[CurationAttemptView] = stored.publications(scope, throughGeneration)
      def find(scope: String, id: UUID): Option[CurationAttemptView] = if (id == nextClaim.attemptId) Some(next) else stored.find(scope, id)
      def latest(scope: String, publishedOnly: Boolean): Option[CurationAttemptView] = if (publishedOnly) stored.latest(scope, true) else Some(next)
    }
    val current = CapsuleContext.cut(reads.current(read, "s").status)
    assertEquals(intercept[Fault](reads.retainedCut(read, "s", current, at.minusSeconds(1))).code, "corrupt")
  }
  test("absence before publication is retained as observation, not inferred from current rows") {
    assertEquals(reads.retainedCut(stored, "s", cut.copy(attempt = None), at), graph)
    assertEquals(reads.retainedCut(stored, "s", CapsuleCut(0L, 0L, 0L, None, None), at), Graph.empty("s"))
  }
}
