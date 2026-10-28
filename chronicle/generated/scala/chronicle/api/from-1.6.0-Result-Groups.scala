import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Groups__From__1_6_0
    extends AbstractConversion[v1_6_0.Result.Groups, Result.Groups] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Result.Groups
      ): Result.Groups = {
        val result: GroupsResult = conversions.convertWithContext[C, v1_6_0.GroupsResult, GroupsResult](context, _from.result)
        Result.Groups(
                result
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Groups"
  }
}