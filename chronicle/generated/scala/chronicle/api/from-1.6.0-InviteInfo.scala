import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__InviteInfo__From__1_6_0
    extends AbstractConversion[v1_6_0.InviteInfo, InviteInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.InviteInfo
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
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#InviteInfo"
  }
}