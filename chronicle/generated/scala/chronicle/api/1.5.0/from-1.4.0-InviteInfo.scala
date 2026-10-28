import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__InviteInfo__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.InviteInfo, InviteInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.InviteInfo
      ): InviteInfo = {
        val id: UUID = _from.id
        val groupid: UUID = _from.groupId
        val targetid: String = _from.targetId
        val expiresat: String = _from.expiresAt
        InviteInfo(
                id,
                groupid,
                targetid,
                expiresat
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#InviteInfo"
  }
}