package chronicle

import java.time.Instant
import java.util.UUID

/** The claim's log line: ids and counts only, the lease age only of an ended lease that is reclaimed. */
final class ClaimFactsTest extends munit.FunSuite {
  private val now=Instant.parse("2026-11-25T17:00:00Z")
  private val id=UUID.fromString("00000000-0000-4000-8000-000000000001")
  test("a fresh claim, a reclaim of an ended lease, a policy reclaim inside its lease, a row without metadata; each lane by its kind") {
    val fresh=ClaimFacts(0,ClaimStep.Preferred,"Queued",None,Some(now.minusSeconds(4380)),Some(false),false)
    assertEquals(ClaimFacts.logLine(id,fresh,ClaimLane.of(0,1),now),s"job claimed jobId=$id lane=0 laneKind=large class=fresh step=Preferred reclaimed=false invalidated=false leaseEndedSeconds=- waitingSeconds=4380")
    val held=fresh.copy(preLeaseUntil=Some(now.minusSeconds(5)))
    assertEquals(ClaimFacts.logLine(id,held,ClaimLane.of(0,1),now),s"job claimed jobId=$id lane=0 laneKind=large class=fresh step=Preferred reclaimed=false invalidated=false leaseEndedSeconds=- waitingSeconds=4380")
    val reclaim=ClaimFacts(2,ClaimStep.Borrowed,"Running",Some(now.minusSeconds(1200)),Some(now.minusSeconds(7200)),Some(true),false)
    assertEquals(ClaimFacts.logLine(id,reclaim,ClaimLane.of(2,1),now),s"job claimed jobId=$id lane=2 laneKind=fresh class=bulk step=Borrowed reclaimed=true invalidated=false leaseEndedSeconds=1200 waitingSeconds=7200")
    val policy=reclaim.copy(preLeaseUntil=Some(now.plusSeconds(60)),invalidated=true)
    assertEquals(ClaimFacts.logLine(id,policy,ClaimLane.of(2,1),now),s"job claimed jobId=$id lane=2 laneKind=fresh class=bulk step=Borrowed reclaimed=true invalidated=true leaseEndedSeconds=- waitingSeconds=7200")
    val legacy=ClaimFacts(1,ClaimStep.Legacy,"Queued",None,None,None,false)
    assertEquals(ClaimFacts.logLine(id,legacy,ClaimLane.of(1,1),now),s"job claimed jobId=$id lane=1 laneKind=bulk class=unknown step=Legacy reclaimed=false invalidated=false leaseEndedSeconds=- waitingSeconds=-")
  }
}
