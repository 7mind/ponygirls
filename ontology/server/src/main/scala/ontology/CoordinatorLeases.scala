package ontology

import java.time.Instant
import ontology.api.*
import ontology.domain.*

private[ontology] object CoordinatorLeases {
  private def time(value: String): Instant = try Instant.parse(value) catch {
    case _: java.time.format.DateTimeParseException => throw Fault("corrupt", "invalid coordinator timestamp")
  }
  def validate(value: CoordinatorState): CoordinatorState = {
    Require(value.epoch >= 0 && value.lease.forall(_.fence.epoch == value.epoch), "corrupt", "coordinator epoch mismatch")
    value.lease.foreach { lease =>
      Require(lease.fence.epoch > 0 && !time(lease.renewedAt).isBefore(time(lease.acquiredAt)) && time(lease.expiresAt).isAfter(time(lease.renewedAt)),
        "corrupt", "invalid coordinator lease")
    }
    value
  }
  def live(value: CoordinatorState, fence: CoordinatorFence, now: Instant): CoordinatorLease = {
    val lease = validate(value).lease.getOrElse(throw Fault("coordinator", "coordinator is not held"))
    Require(lease.fence == fence && !now.isBefore(time(lease.renewedAt)) && now.isBefore(time(lease.expiresAt)),
      "coordinator", "coordinator fence or lease is unavailable")
    lease
  }
}
