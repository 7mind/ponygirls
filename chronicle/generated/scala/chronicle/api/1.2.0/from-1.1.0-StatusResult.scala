import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__StatusResult__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.StatusResult, StatusResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.StatusResult
      ): StatusResult = {
        val jobs: List[JobInfo] = _from.jobs.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_1_0.JobInfo, JobInfo](context, e1)).toList
        val total: Int = _from.total
        StatusResult(
                jobs,
                total
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/:#StatusResult"
  }
}