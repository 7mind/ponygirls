import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__RemoveMember__From__1_7_0
    extends AbstractConversion[v1_7_0.Operation.RemoveMember, Operation.RemoveMember] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Operation.RemoveMember
      ): Operation.RemoveMember = {
        val groupid: UUID = _from.groupId
        val userid: String = _from.userId
        Operation.RemoveMember(
                groupid,
                userid
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#RemoveMember"
  }
}