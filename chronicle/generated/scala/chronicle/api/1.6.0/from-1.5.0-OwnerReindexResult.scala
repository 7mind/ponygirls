import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__OwnerReindexResult__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.OwnerReindexResult, OwnerReindexResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.OwnerReindexResult
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
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#OwnerReindexResult"
  }
}