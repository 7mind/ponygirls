import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityResult__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.ActivityResult, ActivityResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.ActivityResult
      ): ActivityResult = {
        val observedat: String = _from.observedAt
        val user: UserInfo = conversions.convertWithContext[C, chronicle.api.v1_6_0.UserInfo, UserInfo](context, _from.user)
        val archiveheads: Long = _from.archiveHeads
        val headswithouttargetjob: Long = _from.headsWithoutTargetJob
        val current: JobCounts = conversions.convertWithContext[C, chronicle.api.v1_6_0.JobCounts, JobCounts](context, _from.current)
        val historical: JobCounts = conversions.convertWithContext[C, chronicle.api.v1_6_0.JobCounts, JobCounts](context, _from.historical)
        val collectors: List[ActivityCollector] = _from.collectors.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_6_0.ActivityCollector, ActivityCollector](context, e1)).toList
        val totalcollectors: Long = _from.totalCollectors
        val allcollectors: Long = _from.allCollectors
        val nextcursor: Option[String] = _from.nextCursor.map(e1 => e1)
        ActivityResult(
                observedat,
                user,
                archiveheads,
                headswithouttargetjob,
                current,
                historical,
                collectors,
                totalcollectors,
                allcollectors,
                nextcursor
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ActivityResult"
  }
}