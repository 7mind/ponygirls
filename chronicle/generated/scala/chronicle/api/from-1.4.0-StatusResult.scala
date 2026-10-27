import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__StatusResult__From__1_4_0
    extends AbstractConversion[v1_4_0.StatusResult, StatusResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.StatusResult
      ): StatusResult = {
        val jobs: List[JobInfo] = _from.jobs.map(e1 => conversions.convertWithContext[C, v1_4_0.JobInfo, JobInfo](context, e1)).toList
        val total: Int = _from.total
        StatusResult(
                jobs,
                total
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#StatusResult"
  }
}