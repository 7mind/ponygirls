package ontology.domain

import java.util.UUID
import munit.FunSuite
import ontology.api.*
import ontology.{Digests, Wire}
import ontology.curation.CurationInputs

final class CurationReceiptSuite extends FunSuite {
  private val at = "2026-11-11T00:00:05Z"
  private val service = Actor("fixture-service", ActorKind.Service)
  private val curator = Actor("fixture-curator", ActorKind.Agent)
  private val trace = RequestTrace(UUID.randomUUID(), "curation.publish", RequestTransport.Internal)
  private val claim = CurationClaim(UUID.randomUUID(), "controlled-curation", CoordinatorFence(UUID.randomUUID(), 1L), 1L, 1L, 0L, CurationGuardLimits(3, 65536, 1048576L, 128, 128).toWire,
    "fixture", "1" * 64, "2" * 64, "3" * 64, "4" * 64, "2026-11-11T00:00:00Z")
  private val manifest = CurationInputManifest(claim.attemptId, Nil, List(CurationSourcePin(Ref(UUID.randomUUID(), 1), 1L, "5" * 64)),
    CurationInputs.Encoding, "6" * 64, 2L, "2026-11-11T00:00:01Z")
  private val proposal = CurationProposal(1L, 1L, Nil)
  private val publication = CurationPublicationInput(claim, manifest, 1, "7" * 64, proposal, Digests.text(Wire.encode(CurationProposal.codecJson, proposal).noSpaces), at)
  private def receipt(value: CurationPublicationInput): InputReceipt = InputReceipts.create(
    InputReceipts.id(InputKind.Curation, claim.scope, claim.attemptId), claim.scope, 2L, InputKind.Curation, curator, service, service,
    "ontology.api.CurationPublicationInput/0.1.0 canonical JSON", Wire.encode(CurationPublicationInput.codecJson, value).noSpaces, at,
    Contexts.server(trace, Contexts.ProtocolLimits), trace)

  test("receipt-local consistency preserves a complete typed input without claiming graph or journal validation") {
    InputReceipts.validateContext(receipt(publication))
  }

  test("Curation receipt identity coordinates attribution and context must match its canonical input") {
    val original = receipt(publication)
    val bearer = trace.copy(transport = RequestTransport.Bearer)
    val wrong = List(original.copy(scope = "different"), original.copy(generation = 3L), original.copy(ref = Ref(UUID.randomUUID(), 1)),
      original.copy(recordedAt = "2026-11-11T00:00:06Z"), original.copy(contributor = curator.copy(kind = ActorKind.Human)),
      original.copy(recorder = curator), original.copy(submitter = curator),
      original.copy(ingress = bearer, contributionContext = Contexts.server(bearer, Contexts.ProtocolLimits)),
      original.copy(contributionContext = ContextRecord(OriginContext.Unknown("Not retained"), Nil)),
      receipt(publication.copy(proposalDigest = "8" * 64)))
    wrong.foreach(value => assertEquals(intercept[Fault](InputReceipts.validateContext(value)).code, "corrupt"))
  }

  test("Curation receipts reject missing canonical publication input") {
    val scope = "controlled-curation"
    val attemptId = UUID.randomUUID()
    val service = Actor("fixture-service", ActorKind.Service)
    val trace = RequestTrace(UUID.randomUUID(), "curation.publish", RequestTransport.Internal)
    val receipt = InputReceipts.create(InputReceipts.id(InputKind.Curation, scope, attemptId), scope, 2L, InputKind.Curation,
      Actor("fixture-curator", ActorKind.Agent), service, service,
      "ontology.api.CurationPublicationInput/0.1.0 canonical JSON", "{}", "2026-11-11T00:00:05Z",
      Contexts.server(trace, Contexts.ProtocolLimits), trace)
    assertEquals(intercept[Fault](InputReceipts.validateContext(receipt)).code, "corrupt")
  }
}
