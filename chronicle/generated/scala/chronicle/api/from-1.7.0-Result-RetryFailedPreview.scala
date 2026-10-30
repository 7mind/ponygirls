import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__RetryFailedPreview__From__1_7_0
    extends AbstractConversion[v1_7_0.Result.RetryFailedPreview, Result.RetryFailedPreview] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Result.RetryFailedPreview
      ): Result.RetryFailedPreview = {
        val result: RetryFailedPlan = conversions.convertWithContext[C, v1_7_0.RetryFailedPlan, RetryFailedPlan](context, _from.result)
        Result.RetryFailedPreview(
                result
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#RetryFailedPreview"
  }
}