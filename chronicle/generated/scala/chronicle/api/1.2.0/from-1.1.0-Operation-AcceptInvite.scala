import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__AcceptInvite__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.Operation.AcceptInvite, Operation.AcceptInvite] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.Operation.AcceptInvite
      ): Operation.AcceptInvite = {
        val invitationid: UUID = _from.invitationId
        val confirmsharing: Boolean = _from.confirmSharing
        Operation.AcceptInvite(
                invitationid,
                confirmsharing
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#AcceptInvite"
  }
}