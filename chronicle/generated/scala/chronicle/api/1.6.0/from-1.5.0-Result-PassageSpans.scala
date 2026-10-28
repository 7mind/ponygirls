import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__PassageSpans__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Result.PassageSpans, Result.PassageSpans] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Result.PassageSpans
      ): Result.PassageSpans = {
        val result: PassageSpansResult = conversions.convertWithContext[C, chronicle.api.v1_5_0.PassageSpansResult, PassageSpansResult](context, _from.result)
        Result.PassageSpans(
                result
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#PassageSpans"
  }
}