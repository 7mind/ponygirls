package ontology.domain

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.Wire
import ontology.api.*

final class HumanActionWireSuite extends FunSuite {
  private def request(action: Json): Json = Json.obj(
    "scope" -> Json.fromString("controlled-review"), "requestId" -> Json.fromString(UUID.randomUUID().toString),
    "presentationId" -> Json.fromString(UUID.randomUUID().toString), "action" -> action,
    "rationale" -> Json.fromString("The explicit selected alternative is B; not an execution permission."))
  private def json(value: String): Json = io.circe.parser.parse(value).fold(throw _, identity)

  test("an exact presented alternative is structured rather than parsed from rationale") {
    val target = Wire.encode(Ref.codecJson, Ref(UUID.randomUUID(), 1))
    val definition = Wire.encode(Ref.codecJson, Ref(UUID.randomUUID(), 3))
    val action = json(s"""{"Choose":{"selection":{"Alternative":{"target":$target,"definition":$definition,"index":1,"label":"B"}}}}""")
    val decoded = Wire.decode(JudgmentRequest.codecJson, request(action))
    assertEquals(Wire.encode(JudgmentRequest.codecJson, decoded).hcursor.downField("action").focus, Some(action))
  }
  test("generic acceptance remains a review action rather than an implicit choice or adoption") {
    val action = json("""{"Review":{"kind":"Accept"}}""")
    val decoded = Wire.decode(JudgmentRequest.codecJson, request(action))
    val encoded = Wire.encode(JudgmentRequest.codecJson, decoded)
    assertEquals(encoded.hcursor.downField("action").focus, Some(action))
    assert(!encoded.asObject.get.contains("kind"))
  }
}
