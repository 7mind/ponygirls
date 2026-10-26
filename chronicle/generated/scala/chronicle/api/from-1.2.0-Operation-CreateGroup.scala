import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__CreateGroup__From__1_2_0
    extends AbstractConversion[v1_2_0.Operation.CreateGroup, Operation.CreateGroup] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.Operation.CreateGroup
      ): Operation.CreateGroup = {
        val name: String = _from.name
        Operation.CreateGroup(
                name
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#CreateGroup"
  }
}