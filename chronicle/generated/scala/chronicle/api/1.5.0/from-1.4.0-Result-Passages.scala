import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Passages__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.Result.Passages, Result.Passages] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.Result.Passages
      ): Result.Passages = {
        val result: PassagesResult = conversions.convertWithContext[C, chronicle.api.v1_4_0.PassagesResult, PassagesResult](context, _from.result)
        Result.Passages(
                result
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Passages"
  }
}