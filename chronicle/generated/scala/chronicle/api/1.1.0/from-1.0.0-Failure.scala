import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Failure__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.Failure, Failure] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.Failure
      ): Failure = {
        val code: String = _from.code
        val message: String = _from.message
        Failure(
                code,
                message
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#Failure"
  }
}