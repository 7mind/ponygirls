package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.Wire
import io.circe.Json
import java.util.UUID

final class ContextWireSuite extends FunSuite {
  private def json(value: String): Json = io.circe.parser.parse(value).fold(throw _, identity)
  private def native(session: String): Json = {
    val context = CaptureContext(session, None, None, LineageStatus.Unknown, "reported-branch", UUID.randomUUID())
    Json.obj("origin" -> Json.obj("ReportedNative" -> Json.obj("context" -> Wire.encode(CaptureContext.codecJson, context))), "reportedInherited" -> Json.arr())
  }
  private def request(occurrence: Json, contribution: Json): Json = Json.obj(
    "scope" -> Json.fromString("fixture"), "requestId" -> Json.fromString(UUID.randomUUID().toString), "eventId" -> Json.fromString(UUID.randomUUID().toString),
    "occurrenceContext" -> occurrence, "contributionContext" -> contribution,
    "origin" -> Json.fromString("UserMessage"), "metadata" -> Wire.encode(CaptureMetadata.codecJson, CaptureMetadata("fixture-entry", None, None, SourceRepresentation.Text, Nil, Nil)),
    "text" -> Json.fromString("Submitted account, not fabricated native metadata"), "observation" -> json("{\"None\":{}}"))

  test("an API submission can omit native occurrence without fabricating a session or epoch") {
    val input = Wire.decode(IngestRequest.codecJson, request(Json.Null, Json.Null))
    val encoded = Wire.encode(IngestRequest.codecJson, input)
    assertEquals(encoded.hcursor.downField("occurrenceContext").focus, Some(Json.Null))
    assertEquals(encoded.hcursor.downField("contributionContext").focus, Some(Json.Null))
    assert(!encoded.asObject.get.contains("context"))
  }
  test("source occurrence and submission session claims remain independently represented") {
    val occurrence = native("source-session-A"); val contribution = native("submission-session-B")
    val input = Wire.decode(IngestRequest.codecJson, request(occurrence, contribution))
    val encoded = Wire.encode(IngestRequest.codecJson, input)
    assertEquals(encoded.hcursor.downField("occurrenceContext").focus, Some(occurrence))
    assertEquals(encoded.hcursor.downField("contributionContext").focus, Some(contribution))
  }
  test("public claims cannot mint a server-owned service-request origin") {
    val forged = json(s"""{"origin":{"ServiceRequest":{"trace":{"hostRequestId":"${UUID.randomUUID()}","operation":"judge","transport":"Cookie"}}},"reportedInherited":[]} """)
    assertEquals(intercept[Fault](Wire.decode(IngestRequest.codecJson, request(forged, Json.Null))).code, "bad-envelope")
    assertEquals(intercept[Fault](Wire.decode(IngestRequest.codecJson, request(Json.Null, forged))).code, "bad-envelope")
  }
}
