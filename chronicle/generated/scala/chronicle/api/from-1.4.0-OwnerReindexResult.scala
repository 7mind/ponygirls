import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__OwnerReindexResult__From__1_4_0
    extends AbstractConversion[v1_4_0.OwnerReindexResult, OwnerReindexResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.OwnerReindexResult
      ): OwnerReindexResult = {
        val requestid: UUID = _from.requestId
        val targetprofile: String = _from.targetProfile
        val heads: Long = _from.heads
        val queued: Long = _from.queued
        val alreadycurrent: Long = _from.alreadyCurrent
        val invalidatedclaims: Long = _from.invalidatedClaims
        OwnerReindexResult(
                requestid,
                targetprofile,
                heads,
                queued,
                alreadycurrent,
                invalidatedclaims
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#OwnerReindexResult"
  }
}