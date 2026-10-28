import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__ActivityJobs__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Result.ActivityJobs, Result.ActivityJobs] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Result.ActivityJobs
      ): Result.ActivityJobs = {
        val result: ActivityJobsResult = conversions.convertWithContext[C, chronicle.api.v1_5_0.ActivityJobsResult, ActivityJobsResult](context, _from.result)
        Result.ActivityJobs(
                result
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#ActivityJobs"
  }
}