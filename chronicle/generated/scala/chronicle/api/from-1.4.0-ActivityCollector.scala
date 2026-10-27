import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityCollector__From__1_4_0
    extends AbstractConversion[v1_4_0.ActivityCollector, ActivityCollector] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.ActivityCollector
      ): ActivityCollector = {
        val collectorid: String = _from.collectorId
        val status: Option[CollectorStatus] = _from.status.map(e1 => conversions.convertWithContext[C, v1_4_0.CollectorStatus, CollectorStatus](context, e1))
        val archiveheads: Long = _from.archiveHeads
        val headswithouttargetjob: Long = _from.headsWithoutTargetJob
        val current: JobCounts = conversions.convertWithContext[C, v1_4_0.JobCounts, JobCounts](context, _from.current)
        val historical: JobCounts = conversions.convertWithContext[C, v1_4_0.JobCounts, JobCounts](context, _from.historical)
        ActivityCollector(
                collectorid,
                status,
                archiveheads,
                headswithouttargetjob,
                current,
                historical
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ActivityCollector"
  }
}