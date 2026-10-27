import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityJob__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.ActivityJob, ActivityJob] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.ActivityJob
      ): ActivityJob = {
        val job: JobInfo = conversions.convertWithContext[C, chronicle.api.v1_3_0.JobInfo, JobInfo](context, _from.job)
        val profile: String = _from.profile
        val classification: ActivityJobClass = conversions.convertWithContext[C, chronicle.api.v1_3_0.ActivityJobClass, ActivityJobClass](context, _from.classification)
        val leaseexpiresat: Option[String] = _from.leaseExpiresAt.map(e1 => e1)
        val leaseactive: Boolean = _from.leaseActive
        val retryable: Boolean = _from.retryable
        val collectorid: String = _from.collectorId
        val session: SessionInfo = conversions.convertWithContext[C, chronicle.api.v1_3_0.SessionInfo, SessionInfo](context, _from.session)
        val lasttimestamp: Option[String] = _from.lastTimestamp.map(e1 => e1)
        ActivityJob(
                job,
                profile,
                classification,
                leaseexpiresat,
                leaseactive,
                retryable,
                collectorid,
                session,
                lasttimestamp
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#ActivityJob"
  }
}