import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__GroupInfo__From__1_2_0
    extends AbstractConversion[v1_2_0.GroupInfo, GroupInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.GroupInfo
      ): GroupInfo = {
        val id: UUID = _from.id
        val name: String = _from.name
        val ownerid: String = _from.ownerId
        val members: List[String] = _from.members.map(e1 => e1).toList
        GroupInfo(
                id,
                name,
                ownerid,
                members
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#GroupInfo"
  }
}