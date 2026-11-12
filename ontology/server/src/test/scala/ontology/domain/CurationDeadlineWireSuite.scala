package ontology.domain

import io.circe.Json
import java.util.UUID
import munit.FunSuite
import ontology.Wire
import ontology.api.*

final class CurationDeadlineWireSuite extends FunSuite {
  private val claimedAt = "2026-11-11T00:00:00Z"
  private val deadlineAt = "2026-11-11T00:01:00Z"
  test("the claim retains an explicit attempt deadline independently of its lease") {
    val claim = CurationClaim(UUID.randomUUID(), "controlled", CoordinatorFence(UUID.randomUUID(), 1L), 1L, 1L, 0L,
      CurationGuardLimits(3, 65536, 1048576L, 128, 128).toWire, "fixture", "1" * 64, "2" * 64, "3" * 64, "4" * 64, claimedAt, deadlineAt)
    val json = Wire.encode(CurationClaim.codecJson, claim).mapObject(_.add("deadlineAt", Json.fromString(deadlineAt)))
    val decoded = Wire.decode(CurationClaim.codecJson, json)
    assertEquals(Wire.encode(CurationClaim.codecJson, decoded), json)
  }
  test("attempt status exposes the retained deadline instead of a current-config estimate") {
    val summary = CurationAttemptSummary(UUID.randomUUID(), 1L, 1L, 0L, CurationAttemptState.Claimed, None, None, None, None, false, claimedAt, deadlineAt, None)
    val json = Wire.encode(CurationAttemptSummary.codecJson, summary).mapObject(_.add("deadlineAt", Json.fromString(deadlineAt)))
    val decoded = Wire.decode(CurationAttemptSummary.codecJson, json)
    assertEquals(Wire.encode(CurationAttemptSummary.codecJson, decoded), json)
  }
}
