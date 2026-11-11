package ontology.domain

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.Wire
import ontology.api.*

final class CurationStatusWireSuite extends FunSuite {
  test("coverage counters do not substitute for the last publication and pinned attempt coordinates") {
    val summary = Json.obj("attemptId" -> Json.fromString(UUID.randomUUID().toString), "baseGeneration" -> Json.fromString("8"),
      "frontier" -> Json.fromString("5"), "previousCoveredFrontier" -> Json.fromString("3"), "state" -> Json.fromString("Running"),
      "inputDigest" -> Json.fromString("a" * 64), "lastOrdinal" -> Json.fromInt(1), "lastStage" -> Json.fromString("DispatchPossible"), "terminalCode" -> Json.Null,
      "auditUncertain" -> Json.True, "claimedAt" -> Json.fromString("2026-11-11T00:00:00Z"), "deadlineAt" -> Json.fromString("2026-11-11T00:02:00Z"), "finishedAt" -> Json.Null)
    val status = Json.obj("scope" -> Json.fromString("controlled"), "generation" -> Json.fromString("9"),
      "frontier" -> Json.fromString("6"), "coveredFrontier" -> Json.fromString("3"), "state" -> Json.fromString("Running"),
      "failure" -> Json.Null, "lastPublicationGeneration" -> Json.fromString("7"), "attempt" -> summary)
    val decoded = Wire.decode(CurationStatus.codecJson, status)
    assertEquals(Wire.encode(CurationStatus.codecJson, decoded), status)
  }
}
