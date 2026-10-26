import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__RetryJob__From__1_1_0
    extends AbstractConversion[v1_1_0.Operation.RetryJob, Operation.RetryJob] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Operation.RetryJob
      ): Operation.RetryJob = {
        val jobid: UUID = _from.jobId
        Operation.RetryJob(
                jobid
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#RetryJob"
  }
}