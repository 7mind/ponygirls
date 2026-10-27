import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ActivityJobs__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.Operation.ActivityJobs, Operation.ActivityJobs] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.Operation.ActivityJobs
      ): Operation.ActivityJobs = {
        val query: ActivityJobsQuery = conversions.convertWithContext[C, chronicle.api.v1_3_0.ActivityJobsQuery, ActivityJobsQuery](context, _from.query)
        Operation.ActivityJobs(
                query
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs"
  }
}