package chronicle

import java.time.{Duration,Instant}
import java.util.UUID

/** The claim order a deployment runs (indexing-claim-order spec, `indexing.claimOrder`): `SourceId` is the order of
  * fe4f69f7 (owner, then source id, the large-job permit taken per iteration); `Waiting` orders candidates by
  * `ch_jobs.waiting_since` within the lanes of their class (`bulkLanes` lanes prefer bulk work, lane 0 runs sized jobs).
  * Whatever the mode, every write path maintains `waiting_since` and `bulk` (Jobs.successorOrder, Jobs.retry,
  * RetryFailedJobs, ReindexCohort): switching the mode never needs a reseed. */
enum ClaimOrderMode {
  case SourceId
  case Waiting(bulkLanes: Int)
}
object ClaimOrderMode {
  /** The configured mode: `indexing.claimOrder` with `indexing.bulkLanes` (validated at start, IndexingCapacity.validate). */
  def of(config: Config): ClaimOrderMode = config.indexing.claimOrder match {
    case ClaimOrderSetting.SourceId => ClaimOrderMode.SourceId
    case ClaimOrderSetting.Waiting => ClaimOrderMode.Waiting(config.indexing.bulkLanes)
  }
}
/** Which selection step of its lane a claim was taken by: the lane's preferred class, the other class (borrowed while the
  * preferred one had no candidate), or today's order (`ClaimOrderMode.SourceId`). */
enum ClaimStep {
  case Preferred,Borrowed,Legacy
}
/** What a claim saw of its job under the job lock, before its UPDATE: the stored state and lease (a lease that ended or a
  * policy-invalidated Running attempt makes it a reclaim), when it began waiting and its class. `waitingSince`/`bulk` are
  * None only on a row an older image wrote after the start fill (until the reseed). */
final case class ClaimFacts(lane: Int,step: ClaimStep,preState: String,preLeaseUntil: Option[Instant],waitingSince: Option[Instant],bulk: Option[Boolean],invalidated: Boolean) {
  def reclaimed: Boolean = preState=="Running"
  def jobClass: String = bulk match { case Some(true) => "bulk"; case Some(false) => "fresh"; case None => "unknown" }
}
object ClaimFacts {
  /** The claim's log line (U3 owns its text): `job claimed jobId lane class step reclaimed leaseEndedSeconds waitingSeconds`,
    * the seconds measured at `now` (the claim transaction's time). */
  def logLine(jobId: UUID,facts: ClaimFacts,now: Instant): String = {
    def seconds(from: Instant): Long = Duration.between(from,now).getSeconds
    val leaseEnded=facts.preLeaseUntil.filter(_ => facts.reclaimed).map(lease => seconds(lease).toString).getOrElse("-")
    val waiting=facts.waitingSince.map(since => seconds(since).toString).getOrElse("-")
    s"job claimed jobId=$jobId lane=${facts.lane} class=${facts.jobClass} step=${facts.step} reclaimed=${facts.reclaimed} leaseEndedSeconds=$leaseEnded waitingSeconds=$waiting"
  }
}
