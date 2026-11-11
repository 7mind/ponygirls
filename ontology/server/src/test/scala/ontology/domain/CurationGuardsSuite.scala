package ontology.domain

import io.circe.Json
import java.time.Instant
import java.util.UUID
import munit.FunSuite
import ontology.{Digests, Principal, TestContexts, Wire}
import ontology.api.*
import ontology.curation.{CurationInput, CurationInputs}

final class CurationGuardsSuite extends FunSuite {
  private val at = Instant.parse("2026-11-11T00:00:00Z")
  private val limits = CurationGuardLimits(3, 65536, 1048576L, 128, 128)
  private val fence = CoordinatorFence(UUID.randomUUID(), 1L)
  private val lease = CoordinatorLease(fence, at.toString, at.toString, at.plusSeconds(60).toString)
  private val actor = Actor("collector", ActorKind.Collector)
  private val captured = new CaptureEngine().apply(Graph.empty("s"), Nil, 0L,
    IngestRequest("s", UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
      CaptureMetadata("fixture", None, None, SourceRepresentation.PiTranscript, Nil, Nil), "Controlled source", Observation.None()),
    Principal("collector", actor, Set("s"), Set(Capability.Capture)), Actor("host", ActorKind.Service), at.toString, TestContexts.trace("fixture"))
  private val graph = captured.snapshot
  private val sources = List(captured.event)
  private val claim = CurationClaim(UUID.randomUUID(), "s", fence, graph.generation, 1L, 0L, limits.toWire, "fixture", "a" * 64, "b" * 64,
    CurationMaterial.graphDigest(graph), CurationMaterial.sourceDigest(sources), at.toString)
  private val claimed = CurationAttempt(claim, CurationAttemptState.Claimed, None, None, None, None, false, None)
  private val material = CurationMaterial.seal(claim, graph, sources, at.plusSeconds(1), limits)
  private val sealedAttempt = CurationGuards.seal(claimed, Nil, graph, sources, lease, at.plusSeconds(1), limits)
  private def payload(text: String): CurationAuditPayload = CurationAuditPayload("application/json", text, Digests.text(text), text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length.toLong)
  private def request(input: CurationInput): CurationAuditPayload = payload(Json.obj("messages" -> Json.arr(
    Json.obj("role" -> Json.fromString("system"), "content" -> Json.fromString("Controlled policy")),
    Json.obj("role" -> Json.fromString("user"), "content" -> Json.fromString(CurationInputs.json(input).noSpaces))
  )).noSpaces)
  private val requestPayload = request(material.input)
  private val proposal = CurationProposal(graph.generation, 1L, Nil)
  private val responsePayload = payload(Json.obj("choices" -> Json.arr(Json.obj("finish_reason" -> Json.fromString("stop"), "message" -> Json.obj("role" -> Json.fromString("assistant"), "content" -> Json.fromString(Wire.encode(CurationProposal.codecJson, proposal).noSpaces))))).noSpaces)
  private val candidate = CurationCandidate(claim.attemptId, material.manifest.inputDigest, 1, responsePayload.digest, proposal, Digests.text(Wire.encode(CurationProposal.codecJson, proposal).noSpaces))
  private def append(a: CurationAttempt, entries: List[CurationAuditRecord], stage: CurationAuditStage, body: Option[CurationAuditPayload], seconds: Long): CurationAuditAppend =
    CurationGuards.append(a, entries, 1, stage, requestPayload.digest, body, lease, at.plusSeconds(seconds), limits)
  private def observed(): CurationAuditAppend = {
    val p = append(sealedAttempt, Nil, CurationAuditStage.RequestPrepared, Some(requestPayload), 2)
    val d = append(p.attempt, p.entries, CurationAuditStage.DispatchPossible, None, 3)
    append(d.attempt, d.entries, CurationAuditStage.ResponseObserved, Some(responsePayload), 4)
  }

  test("eligibility requires new uncovered primary input rather than configuration or graph changes") {
    assert(CurationGuards.eligible(graph, None, false))
    assert(!CurationGuards.eligible(graph, Some(1L), false))
    assert(!CurationGuards.eligible(graph.copy(generation = graph.generation + 1L), Some(1L), false))
    assert(!CurationGuards.eligible(graph, None, true))
    assert(!CurationGuards.eligible(graph.copy(coveredFrontier = 1L), None, false))
    assert(CurationGuards.eligible(graph.copy(sourceFrontier = 2L), Some(1L), false))
    assertEquals(intercept[Fault](CurationGuards.eligible(graph, Some(2L), false)).code, "curation")
    CurationGuards.claim(claim, graph, sources, None, false, lease, at, limits)
    assertEquals(intercept[Fault](CurationGuards.claim(claim, graph, sources, Some(1L), false, lease, at, limits)).code, "curation")
  }

  test("seals reconstruct actual ordered frozen material without truncation") {
    CurationMaterial.verify(claim, graph, sources, material.manifest, limits)
    assertEquals(sealedAttempt.inputManifest, Some(material.manifest))
    assertEquals(CurationGuards.seal(sealedAttempt, Nil, graph, sources, lease, at.plusSeconds(70), limits), sealedAttempt)
    assertEquals(intercept[Fault](CurationMaterial.seal(claim, graph, Nil, at.plusSeconds(1), limits)).code, "curation")
    List(material.manifest.copy(inputBytes = 1L), material.manifest.copy(inputDigest = "c" * 64), material.manifest.copy(seed = material.manifest.seed.reverse)).foreach { altered =>
      assertEquals(intercept[Fault](CurationMaterial.verify(claim, graph, sources, altered, limits)).code, "curation")
    }
    assertEquals(intercept[Fault](CurationMaterial.seal(claim.copy(admissionLimits = limits.copy(maxInputBytes = 1L).toWire), graph, sources, at.plusSeconds(1), limits.copy(maxInputBytes = 1L))).code, "curation")
    assertEquals(intercept[Fault](CurationMaterial.seal(claim.copy(admissionLimits = limits.copy(maxPins = 1).toWire), graph, sources, at.plusSeconds(1), limits.copy(maxPins = 1))).code, "curation")
  }

  test("journal ordering and idempotency preserve original evidence without dispatch inference") {
    val prepared = append(sealedAttempt, Nil, CurationAuditStage.RequestPrepared, Some(requestPayload), 2)
    val dispatched = append(prepared.attempt, prepared.entries, CurationAuditStage.DispatchPossible, None, 3)
    assert(dispatched.attempt.auditUncertain)
    val retry = append(dispatched.attempt, dispatched.entries, CurationAuditStage.RequestPrepared, Some(requestPayload), 70)
    assert(retry.replayed)
    assertEquals(retry.attempt, dispatched.attempt)
    assertEquals(retry.entries, dispatched.entries)
    val changed = payload("{\"changed\":true}")
    assertEquals(intercept[Fault](append(dispatched.attempt, dispatched.entries, CurationAuditStage.RequestPrepared, Some(changed), 4)).code, "replay-conflict")
    assertEquals(intercept[Fault](append(sealedAttempt, Nil, CurationAuditStage.ResponseObserved, Some(responsePayload), 2)).code, "curation")
    assertEquals(intercept[Fault](append(prepared.attempt, prepared.entries, CurationAuditStage.DispatchPossible, Some(requestPayload), 3)).code, "curation")
    assertEquals(intercept[Fault](append(prepared.attempt, prepared.entries, CurationAuditStage.DispatchPossible, None, 70)).code, "curation")
    val foreignLease = lease.copy(fence = fence.copy(epoch = 2))
    assertEquals(intercept[Fault](CurationGuards.append(prepared.attempt, prepared.entries, 1, CurationAuditStage.DispatchPossible, requestPayload.digest, None, foreignLease, at.plusSeconds(3), limits)).code, "curation")
  }

  test("phase and fields cannot teleport a claim into a running or published state") {
    val done = observed()
    val invalid = List(claimed.copy(inputManifest = Some(material.manifest)), claimed.copy(state = CurationAttemptState.Running),
      sealedAttempt.copy(state = CurationAttemptState.Published), done.attempt.copy(state = CurationAttemptState.Claimed),
      done.attempt.copy(inputManifest = None), done.attempt.copy(auditUncertain = true))
    invalid.zipWithIndex.foreach { case (value, index) =>
      val entries = if (index < 3) Nil else done.entries
      assertEquals(intercept[Fault](CurationGuards.validate(value, entries, limits)).code, "curation")
    }
    assertEquals(intercept[Fault](CurationGuards.publication(claimed.copy(inputManifest = Some(material.manifest)), done.entries, candidate, graph, sources, lease, at.plusSeconds(5), limits)).code, "curation")
  }

  test("publication binds response input material head and fence even for an empty delta") {
    val done = observed()
    val plan = CurationGuards.publication(done.attempt, done.entries, candidate, graph, sources, lease, at.plusSeconds(5), limits)
    assertEquals(plan, CurationPublicationPlan(graph.generation + 1L, 1L, 1L))
    val wrong = List(candidate.copy(responseOrdinal = 2), candidate.copy(responseDigest = "c" * 64), candidate.copy(inputDigest = "d" * 64),
      candidate.copy(proposal = proposal.copy(expectedGeneration = graph.generation + 1L)))
    wrong.foreach(value => assertEquals(intercept[Fault](CurationGuards.publication(done.attempt, done.entries, value, graph, sources, lease, at.plusSeconds(5), limits)).code, "curation"))
    assertEquals(intercept[Fault](CurationGuards.publication(done.attempt, done.entries, candidate, graph.copy(generation = graph.generation + 1L), sources, lease, at.plusSeconds(5), limits)).code, "curation-stale")
    assertEquals(intercept[Fault](CurationGuards.publication(done.attempt, done.entries, candidate, graph, sources, lease, at.plusSeconds(70), limits)).code, "curation")
    val altered = done.attempt.copy(inputManifest = Some(material.manifest.copy(seed = material.manifest.seed.reverse)))
    assertEquals(intercept[Fault](CurationGuards.publication(altered, done.entries, candidate, graph, sources, lease, at.plusSeconds(5), limits)).code, "curation")
  }

  test("a separately valid proposal cannot borrow another proposal's observed response digest") {
    val done = observed()
    val other = proposal.copy(operations = List(Operation.Create("different", ApplicabilityInput.Unresolved("Controlled counterexample", Nil, Nil), ContentInput.Statement("Not the observed proposal", Modality.Assertion), Nil)))
    val substituted = candidate.copy(proposal = other, proposalDigest = Digests.text(Wire.encode(CurationProposal.codecJson, other).noSpaces))
    assertEquals(intercept[Fault](CurationGuards.publication(done.attempt, done.entries, substituted, graph, sources, lease, at.plusSeconds(5), limits)).code, "curation")
  }

  test("a seal transition cannot return a manifest rejected by its configured validation bounds") {
    assertEquals(intercept[Fault](CurationGuards.seal(claimed.copy(claim = claim.copy(admissionLimits = limits.copy(maxLabelChars = 7).toWire)), Nil, graph, sources, lease, at.plusSeconds(1), limits.copy(maxLabelChars = 7))).code, "curation")
  }

  test("prepared input checks run before dispatch and on every continuation") {
    val wrong = request(material.input.copy(seed = Nil))
    assertEquals(intercept[Fault](CurationGuards.append(sealedAttempt, Nil, 1, CurationAuditStage.RequestPrepared, wrong.digest, Some(wrong), lease, at.plusSeconds(2), limits)).code, "curation")
    val done = observed()
    assertEquals(intercept[Fault](CurationGuards.append(done.attempt, done.entries, 2, CurationAuditStage.RequestPrepared, wrong.digest, Some(wrong), lease, at.plusSeconds(5), limits)).code, "curation")
  }

  test("equal boundary timestamps remain valid and no-input request bodies reject") {
    val sameTime = CurationGuards.seal(claimed, Nil, graph, sources, lease, at, limits)
    val prepared = append(sameTime, Nil, CurationAuditStage.RequestPrepared, Some(requestPayload), 0)
    val dispatched = append(prepared.attempt, prepared.entries, CurationAuditStage.DispatchPossible, None, 0)
    val done = append(dispatched.attempt, dispatched.entries, CurationAuditStage.ResponseObserved, Some(responsePayload), 0)
    assertEquals(CurationGuards.publication(done.attempt, done.entries, candidate, graph, sources, lease, at, limits), CurationPublicationPlan(graph.generation + 1L, 1L, 1L))
    val omitted = payload("{\"request\":true}")
    assertEquals(intercept[Fault](CurationGuards.append(sealedAttempt, Nil, 1, CurationAuditStage.RequestPrepared, omitted.digest, Some(omitted), lease, at.plusSeconds(2), limits)).code, "curation")
  }

  test("a first prepared request cannot precede the retained input seal") {
    val sealedLater = CurationGuards.seal(claimed, Nil, graph, sources, lease, at.plusSeconds(10), limits)
    assertEquals(intercept[Fault](append(sealedLater, Nil, CurationAuditStage.RequestPrepared, Some(requestPayload), 5)).code, "curation")
  }

  test("publication time cannot precede the final retained response") {
    val done = observed()
    assertEquals(intercept[Fault](CurationGuards.publication(done.attempt, done.entries, candidate, graph, sources, lease, at.plusSeconds(3), limits)).code, "curation")
  }

  test("a different prepared source cut cannot borrow a valid seal and final proposal") {
    val other = request(material.input.copy(sources = sources.map(_.copy(text = "Different source text"))))
    val entries = List(
      CurationAuditRecord(claim.attemptId, claim.scope, fence, 1, CurationAuditStage.RequestPrepared, other.digest, Some(other), at.plusSeconds(2).toString),
      CurationAuditRecord(claim.attemptId, claim.scope, fence, 1, CurationAuditStage.DispatchPossible, other.digest, None, at.plusSeconds(3).toString),
      CurationAuditRecord(claim.attemptId, claim.scope, fence, 1, CurationAuditStage.ResponseObserved, other.digest, Some(responsePayload), at.plusSeconds(4).toString)
    )
    val attempt = sealedAttempt.copy(state = CurationAttemptState.Running)
    assertEquals(intercept[Fault](CurationGuards.publication(attempt, entries, candidate, graph, sources, lease, at.plusSeconds(5), limits)).code, "curation")
  }

  test("terminal uncertainty derives from the journal and retries do not revive attempts") {
    val prepared = append(sealedAttempt, Nil, CurationAuditStage.RequestPrepared, Some(requestPayload), 2)
    val dispatched = append(prepared.attempt, prepared.entries, CurationAuditStage.DispatchPossible, None, 3)
    val stopped = CurationGuards.terminate(dispatched.attempt, dispatched.entries, CurationAttemptState.Interrupted, "owner-expired", at.plusSeconds(70), limits)
    assert(stopped.auditUncertain)
    val replay = append(stopped, dispatched.entries, CurationAuditStage.DispatchPossible, None, 80)
    assert(replay.replayed)
    assertEquals(replay.attempt, stopped)
    assertEquals(intercept[Fault](append(stopped, dispatched.entries, CurationAuditStage.ResponseObserved, Some(responsePayload), 80)).code, "curation")
    assertEquals(intercept[Fault](CurationGuards.terminate(stopped, dispatched.entries, CurationAttemptState.Failed, "changed", at.plusSeconds(80), limits)).code, "curation")
    val response = observed()
    val rejected = CurationGuards.terminate(response.attempt, response.entries, CurationAttemptState.Failed, "candidate-rejected", at.plusSeconds(5), limits)
    assert(!rejected.auditUncertain)
    assert(!CurationGuards.eligible(graph, Some(stopped.claim.frontier), false))
  }
}
