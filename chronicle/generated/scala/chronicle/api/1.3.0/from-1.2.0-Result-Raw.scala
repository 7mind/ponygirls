import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Raw__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Result.Raw, Result.Raw] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Result.Raw
      ): Result.Raw = {
        val result: RawResult = conversions.convertWithContext[C, chronicle.api.v1_2_0.RawResult, RawResult](context, _from.result)
        Result.Raw(
                result
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Raw"
  }
}