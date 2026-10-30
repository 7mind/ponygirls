import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RetryFailedResult__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.RetryFailedResult, RetryFailedResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.RetryFailedResult
      ): RetryFailedResult = {
        val requestid: UUID = _from.requestId
        val targetprofile: String = _from.targetProfile
        val retried: Long = _from.retried
        val counts: RetryFailedCounts = conversions.convertWithContext[C, chronicle.api.v1_6_0.RetryFailedCounts, RetryFailedCounts](context, _from.counts)
        RetryFailedResult(
                requestid,
                targetprofile,
                retried,
                counts
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#RetryFailedResult"
  }
}