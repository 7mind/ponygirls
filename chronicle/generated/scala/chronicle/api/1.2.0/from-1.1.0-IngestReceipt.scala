import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__IngestReceipt__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.IngestReceipt, IngestReceipt] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.IngestReceipt
      ): IngestReceipt = {
        val requestid: UUID = _from.requestId
        val sessionid: UUID = _from.sessionId
        val revision: Int = _from.revision
        val jobid: UUID = _from.jobId
        IngestReceipt(
                requestid,
                sessionid,
                revision,
                jobid
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/:#IngestReceipt"
  }
}