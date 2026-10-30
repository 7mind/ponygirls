import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ReindexStatusResult__From__1_7_0
    extends AbstractConversion[v1_7_0.ReindexStatusResult, ReindexStatusResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.ReindexStatusResult
      ): ReindexStatusResult = {
        val requestid: UUID = _from.requestId
        val targetprofile: String = _from.targetProfile
        val total: Long = _from.total
        val complete: Long = _from.complete
        val superseded: Long = _from.superseded
        val failed: Long = _from.failed
        val pending: Long = _from.pending
        ReindexStatusResult(
                requestid,
                targetprofile,
                total,
                complete,
                superseded,
                failed,
                pending
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#ReindexStatusResult"
  }
}