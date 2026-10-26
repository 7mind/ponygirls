import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Failure__From__1_3_0
    extends AbstractConversion[v1_3_0.Failure, Failure] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.Failure
      ): Failure = {
        val code: String = _from.code
        val message: String = _from.message
        Failure(
                code,
                message
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#Failure"
  }
}