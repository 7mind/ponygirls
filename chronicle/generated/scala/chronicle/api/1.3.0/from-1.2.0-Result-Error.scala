import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Error__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Result.Error, Result.Error] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Result.Error
      ): Result.Error = {
        val failure: Failure = conversions.convertWithContext[C, chronicle.api.v1_2_0.Failure, Failure](context, _from.failure)
        Result.Error(
                failure
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Error"
  }
}