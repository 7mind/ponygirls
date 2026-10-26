import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__RetryFailed__From__1_3_0
    extends AbstractConversion[v1_3_0.Result.RetryFailed, Result.RetryFailed] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.Result.RetryFailed
      ): Result.RetryFailed = {
        val result: RetryFailedResult = conversions.convertWithContext[C, v1_3_0.RetryFailedResult, RetryFailedResult](context, _from.result)
        Result.RetryFailed(
                result
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#RetryFailed"
  }
}