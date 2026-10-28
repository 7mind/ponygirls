import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityJobsResult__From__1_6_0
    extends AbstractConversion[v1_6_0.ActivityJobsResult, ActivityJobsResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.ActivityJobsResult
      ): ActivityJobsResult = {
        val observedat: String = _from.observedAt
        val jobs: List[ActivityJob] = _from.jobs.map(e1 => conversions.convertWithContext[C, v1_6_0.ActivityJob, ActivityJob](context, e1)).toList
        val total: Long = _from.total
        val nextcursor: Option[String] = _from.nextCursor.map(e1 => e1)
        ActivityJobsResult(
                observedat,
                jobs,
                total,
                nextcursor
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ActivityJobsResult"
  }
}