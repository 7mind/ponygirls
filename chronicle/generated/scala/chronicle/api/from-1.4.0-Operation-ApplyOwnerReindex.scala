import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ApplyOwnerReindex__From__1_4_0
    extends AbstractConversion[v1_4_0.Operation.ApplyOwnerReindex, Operation.ApplyOwnerReindex] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Operation.ApplyOwnerReindex
      ): Operation.ApplyOwnerReindex = {
        val targetprofile: String = _from.targetProfile
        val selectionhash: String = _from.selectionHash
        val confirm: Boolean = _from.confirm
        Operation.ApplyOwnerReindex(
                targetprofile,
                selectionhash,
                confirm
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ApplyOwnerReindex"
  }
}