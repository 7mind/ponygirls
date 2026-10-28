import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Activity__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Result.Activity, Result.Activity] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Result.Activity
      ): Result.Activity = {
        val result: ActivityResult = conversions.convertWithContext[C, chronicle.api.v1_5_0.ActivityResult, ActivityResult](context, _from.result)
        Result.Activity(
                result
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Activity"
  }
}