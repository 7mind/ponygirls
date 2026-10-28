import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ActivityJobs__From__1_6_0
    extends AbstractConversion[v1_6_0.Operation.ActivityJobs, Operation.ActivityJobs] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Operation.ActivityJobs
      ): Operation.ActivityJobs = {
        val query: ActivityJobsQuery = conversions.convertWithContext[C, v1_6_0.ActivityJobsQuery, ActivityJobsQuery](context, _from.query)
        Operation.ActivityJobs(
                query
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ActivityJobs"
  }
}