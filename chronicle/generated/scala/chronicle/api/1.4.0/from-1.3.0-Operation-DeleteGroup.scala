import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__DeleteGroup__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.Operation.DeleteGroup, Operation.DeleteGroup] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.Operation.DeleteGroup
      ): Operation.DeleteGroup = {
        val groupid: UUID = _from.groupId
        Operation.DeleteGroup(
                groupid
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#DeleteGroup"
  }
}