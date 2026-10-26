import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__LeaveGroup__From__1_2_0
    extends AbstractConversion[v1_2_0.Operation.LeaveGroup, Operation.LeaveGroup] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.Operation.LeaveGroup
      ): Operation.LeaveGroup = {
        val groupid: UUID = _from.groupId
        Operation.LeaveGroup(
                groupid
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#LeaveGroup"
  }
}