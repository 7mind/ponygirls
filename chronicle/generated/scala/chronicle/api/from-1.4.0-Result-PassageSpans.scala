import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__PassageSpans__From__1_4_0
    extends AbstractConversion[v1_4_0.Result.PassageSpans, Result.PassageSpans] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Result.PassageSpans
      ): Result.PassageSpans = {
        val result: PassageSpansResult = conversions.convertWithContext[C, v1_4_0.PassageSpansResult, PassageSpansResult](context, _from.result)
        Result.PassageSpans(
                result
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#PassageSpans"
  }
}