package ontology.domain

import munit.FunSuite
import ontology.api.*
import ontology.Wire
import io.circe.Json
import java.util.UUID

final class ApplicabilityWireSuite extends FunSuite {
  test("semantic applicability is independently represented from the access namespace") {
    val id = UUID.randomUUID()
    val json = io.circe.parser.parse(s"""{"scope":"acl-project","requestId":"$id","expectedGeneration":"0","contributionContext":null,"operations":[{"Create":{"alias":"claim","applicability":{"Declared":{"statement":"Only component A in this release","basis":[],"context":[]}},"content":{"Statement":{"text":"Observed claim","modality":"Assertion"}},"basis":[]}}]}""").toOption.get
    val request = Wire.decode(ApplyRequest.codecJson, json)
    val result = new AdmissionEngine().apply(Graph.empty("acl-project"), request, Admission(ontology.TestContexts.principal("acl-project", Actor("a", ActorKind.Agent)), Actor("host", ActorKind.Service), id, "2026-11-11T00:00:00Z", ontology.TestContexts.trace("fixture-apply"), Nil))
    val encoded = Wire.encode(Definition.codecJson, result.snapshot.definitions.head)
    assertEquals(encoded.hcursor.get[String]("scope"), Right("acl-project"))
    assertEquals(encoded.hcursor.downField("applicability").downField("Declared").get[String]("statement"), Right("Only component A in this release"))
  }
}
