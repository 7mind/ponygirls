package ontology.domain

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.{Digests, Wire}
import ontology.api.*

final class SourceDescriptorWireSuite extends FunSuite {
  test("derived presentation Source has no fabricated primary event or native context") {
    val text = "Controlled retained presentation payload"
    val descriptor = Json.obj("DerivedPresentation" -> Json.obj(
      "presentationId" -> Json.fromString(UUID.randomUUID().toString), "generation" -> Json.fromString("5"),
      "payloadDigest" -> Json.fromString(Digests.text(text)), "preparedAt" -> Json.fromString("2026-11-11T00:00:00Z"),
      "preparationTrace" -> Wire.encode(RequestTrace.codecJson, RequestTrace(UUID.randomUUID(), "/api/v1/present", RequestTransport.Cookie))))
    val input = Json.obj("Source" -> Json.obj("text" -> Json.fromString(text), "context" -> Json.arr(), "rawDigest" -> Json.fromString(Digests.text(text)), "descriptor" -> descriptor))
    val decoded = Wire.decode(Content.codecJson, input)
    val encoded = Wire.encode(Content.codecJson, decoded)
    assertEquals(encoded, input)
    val source = encoded.hcursor.downField("Source").focus.get.asObject.get
    assertEquals(source.keys.toSet, Set("text", "context", "rawDigest", "descriptor"))
  }
  test("ordinary ingest cannot supply protected response linkage or the HumanJudgment representation") {
    val request = IngestRequest("scope", UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
      CaptureMetadata("submitted", None, None, SourceRepresentation.Text, Nil, Nil), "A submitted account", Observation.None())
    val link = ReviewResponseLink(UUID.randomUUID(), UUID.randomUUID(), Ref(UUID.randomUUID(), 1), "a" * 64)
    val forged = Wire.encode(IngestRequest.codecJson, request).mapObject(_.add("reviewResponse", Wire.encode(ReviewResponseLink.codecJson, link)))
    assertEquals(intercept[Fault](Wire.decode(IngestRequest.codecJson, forged)).code, "bad-envelope")
    val principal = ontology.Principal("human", Actor("human", ActorKind.Human), Set("scope"), Set(Capability.Capture))
    val engine = new CaptureEngine
    engine.validateIngress(request, principal)
    assertEquals(intercept[Fault](engine.validateIngress(request.copy(metadata = request.metadata.copy(representation = SourceRepresentation.HumanJudgment)), principal)).code, "capture-origin")
  }
}
