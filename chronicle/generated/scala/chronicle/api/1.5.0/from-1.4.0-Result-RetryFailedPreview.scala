import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__RetryFailedPreview__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.Result.RetryFailedPreview, Result.RetryFailedPreview] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.Result.RetryFailedPreview
      ): Result.RetryFailedPreview = {
        val result: RetryFailedPlan = conversions.convertWithContext[C, chronicle.api.v1_4_0.RetryFailedPlan, RetryFailedPlan](context, _from.result)
        Result.RetryFailedPreview(
                result
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview"
  }
}