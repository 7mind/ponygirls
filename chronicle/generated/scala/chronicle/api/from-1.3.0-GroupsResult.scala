import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__GroupsResult__From__1_3_0
    extends AbstractConversion[v1_3_0.GroupsResult, GroupsResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.GroupsResult
      ): GroupsResult = {
        val groups: List[GroupInfo] = _from.groups.map(e1 => conversions.convertWithContext[C, v1_3_0.GroupInfo, GroupInfo](context, e1)).toList
        val invitations: List[InviteInfo] = _from.invitations.map(e1 => conversions.convertWithContext[C, v1_3_0.InviteInfo, InviteInfo](context, e1)).toList
        GroupsResult(
                groups,
                invitations
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#GroupsResult"
  }
}