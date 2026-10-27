import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__JobCounts__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.JobCounts, JobCounts] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.JobCounts
      ): JobCounts = {
        val total: Long = _from.total
        val queued: Long = _from.queued
        val running: Long = _from.running
        val failed: Long = _from.failed
        val complete: Long = _from.complete
        val activerunning: Long = _from.activeRunning
        val expiredrunning: Long = _from.expiredRunning
        val unleasedrunning: Long = _from.unleasedRunning
        JobCounts(
                total,
                queued,
                running,
                failed,
                complete,
                activerunning,
                expiredrunning,
                unleasedrunning
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#JobCounts"
  }
}