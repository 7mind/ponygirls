import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RetryFailedPlan__From__1_7_0
    extends AbstractConversion[v1_7_0.RetryFailedPlan, RetryFailedPlan] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.RetryFailedPlan
      ): RetryFailedPlan = {
        val targetprofile: String = _from.targetProfile
        val selectionhash: String = _from.selectionHash
        val counts: RetryFailedCounts = conversions.convertWithContext[C, v1_7_0.RetryFailedCounts, RetryFailedCounts](context, _from.counts)
        RetryFailedPlan(
                targetprofile,
                selectionhash,
                counts
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#RetryFailedPlan"
  }
}