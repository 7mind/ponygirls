package ontology.domain

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.Wire
import ontology.api.*

final class CapsuleWireSuite extends FunSuite {
  private def id: Json = Json.fromString(UUID.randomUUID().toString)
  test("capsule requests separate explicit semantic context from absent reported native context") {
    val request = Json.obj("scope" -> Json.fromString("controlled"), "requestId" -> id, "workContext" -> Json.fromString("task-context"),
      "reportedContext" -> Json.Null, "expectedFrontier" -> Json.fromString("0"), "previousCapsuleId" -> Json.Null)
    assertEquals(Wire.encode(CapsuleRequest.codecJson, Wire.decode(CapsuleRequest.codecJson, request)), request)
  }
  test("delivery reports distinguish server capsule digest from unverified boundary digest") {
    val request = Json.obj("scope" -> Json.fromString("controlled"), "requestId" -> id, "capsuleId" -> id,
      "capsulePayloadDigest" -> Json.fromString("a" * 64), "workContext" -> Json.fromString("task-context"), "reportedContext" -> Json.Null,
      "boundary" -> Json.fromString("ExtensionContext"), "reportedAt" -> Json.Null,
      "reportedBoundaryPayload" -> Json.obj("encoding" -> Json.fromString("controlled-boundary-json"), "digest" -> Json.fromString("b" * 64)))
    assertEquals(Wire.encode(DeliveryRequest.codecJson, Wire.decode(DeliveryRequest.codecJson, request)), request)
  }
  test("added and removed records do not require fabricated counterpart references") {
    val ref = Ref(UUID.randomUUID(), 1)
    val added = CapsuleChange(None, Some(ref), ref, None, Nil, Nil)
    val removed = CapsuleChange(Some(ref), None, ref, None, Nil, Nil)
    List(added, removed).foreach { value =>
      val json = Wire.encode(CapsuleChange.codecJson, value)
      assertEquals(Wire.decode(CapsuleChange.codecJson, json), value)
    }
  }
  test("capsules retain owner cut manifest policy and preparation trace without inventing native identity") {
    val actor = Wire.encode(Actor.codecJson, Actor("fixture-agent", ActorKind.Agent))
    val context = Wire.encode(ContextRecord.codecJson, Contexts.normalize(None, "No reported capsule context was supplied", Contexts.ProtocolLimits))
    val trace = Wire.encode(RequestTrace.codecJson, RequestTrace(UUID.randomUUID(), "capsule.prepare", RequestTransport.Bearer))
    val payload = Json.obj("scope" -> Json.fromString("controlled"), "workContext" -> Json.fromString("task-context"), "reportedContext" -> context,
      "cut" -> Json.obj("generation" -> Json.fromString("0"), "frontier" -> Json.fromString("0"), "coveredFrontier" -> Json.fromString("0"), "lastPublicationGeneration" -> Json.Null, "attempt" -> Json.Null),
      "previousCapsuleId" -> Json.Null, "policy" -> Json.obj("id" -> Json.fromString("fixture"), "digest" -> Json.fromString("c" * 64)),
      "records" -> Json.arr(), "manifest" -> Json.obj("entries" -> Json.arr(), "changes" -> Json.arr(), "qualifications" -> Json.arr()), "text" -> Json.fromString("Controlled wire fixture"))
    val capsule = Json.obj("id" -> id, "requestId" -> id, "owner" -> actor, "payload" -> payload, "payloadDigest" -> Json.fromString("d" * 64),
      "limits" -> Json.obj("maxRecords" -> Json.fromInt(10), "maxPayloadBytes" -> Json.fromInt(4096)), "preparedAt" -> Json.fromString("2026-11-11T00:00:00Z"), "preparationTrace" -> trace)
    assertEquals(Wire.encode(Capsule.codecJson, Wire.decode(Capsule.codecJson, capsule)), capsule)
  }
}
