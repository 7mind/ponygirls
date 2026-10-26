import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Raw__From__1_1_0
    extends AbstractConversion[v1_1_0.Result.Raw, Result.Raw] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Result.Raw
      ): Result.Raw = {
        val result: RawResult = conversions.convertWithContext[C, v1_1_0.RawResult, RawResult](context, _from.result)
        Result.Raw(
                result
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Raw"
  }
}