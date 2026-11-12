package ontology.domain

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.Wire
import ontology.api.*

final class ExecutionWireSuite extends FunSuite {
  test("captured execution distinguishes consumed inputs from observed outputs") {
    val input = Wire.encode(Ref.codecJson, Ref(UUID.randomUUID(), 1))
    val output = Wire.encode(Ref.codecJson, Ref(UUID.randomUUID(), 2))
    val value = Json.obj("Execution" -> Json.obj(
      "action" -> Json.fromString("controlled build"), "checker" -> Json.fromString("fixture host instrument"),
      "contract" -> Json.Null, "inputs" -> Json.arr(input), "outputs" -> Json.arr(output),
      "exitCode" -> Json.fromInt(1), "complete" -> Json.fromBoolean(true)))
    val decoded = Wire.decode(Observation.codecJson, value)
    val encoded = Wire.encode(Observation.codecJson, decoded)
    assertEquals(encoded, value)
    val execution = encoded.hcursor.downField("Execution").focus.get.asObject.get
    assert(!execution.contains("artifacts"))
    assertEquals(execution("inputs"), Some(Json.arr(input)))
    assertEquals(execution("outputs"), Some(Json.arr(output)))
  }
}
