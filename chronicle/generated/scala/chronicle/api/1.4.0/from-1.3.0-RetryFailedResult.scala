import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RetryFailedResult__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.RetryFailedResult, RetryFailedResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.RetryFailedResult
      ): RetryFailedResult = {
        val requestid: UUID = _from.requestId
        val targetprofile: String = _from.targetProfile
        val retried: Long = _from.retried
        val counts: RetryFailedCounts = conversions.convertWithContext[C, chronicle.api.v1_3_0.RetryFailedCounts, RetryFailedCounts](context, _from.counts)
        RetryFailedResult(
                requestid,
                targetprofile,
                retried,
                counts
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#RetryFailedResult"
  }
}