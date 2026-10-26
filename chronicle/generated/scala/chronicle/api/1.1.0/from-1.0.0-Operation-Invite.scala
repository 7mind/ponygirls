import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Invite__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.Operation.Invite, Operation.Invite] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.Operation.Invite
      ): Operation.Invite = {
        val groupid: UUID = _from.groupId
        val targetid: String = _from.targetId
        Operation.Invite(
                groupid,
                targetid
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Invite"
  }
}