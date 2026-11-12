package ontology.domain

import io.circe.Json
import munit.FunSuite
import ontology.Wire
import ontology.api.*

final class PlanRequirementWireSuite extends FunSuite {
  test("a plan requirement declares its binding work context rather than applying to every context") {
    val json = Json.obj("PlanRequirement" -> Json.obj("workContext" -> Json.fromString("context-A")))
    val stored = Wire.decode(RelationDetail.codecJson, json)
    val input = Wire.decode(RelationDetailInput.codecJson, json)
    assertEquals(Wire.encode(RelationDetail.codecJson, stored), json)
    assertEquals(Wire.encode(RelationDetailInput.codecJson, input), json)
  }
}
