import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ApplyRetryFailed__From__1_3_0
    extends AbstractConversion[v1_3_0.Operation.ApplyRetryFailed, Operation.ApplyRetryFailed] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.Operation.ApplyRetryFailed
      ): Operation.ApplyRetryFailed = {
        val targetprofile: String = _from.targetProfile
        val selectionhash: String = _from.selectionHash
        val confirm: Boolean = _from.confirm
        Operation.ApplyRetryFailed(
                targetprofile,
                selectionhash,
                confirm
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ApplyRetryFailed"
  }
}