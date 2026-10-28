import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RetryFailedPlan__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.RetryFailedPlan, RetryFailedPlan] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.RetryFailedPlan
      ): RetryFailedPlan = {
        val targetprofile: String = _from.targetProfile
        val selectionhash: String = _from.selectionHash
        val counts: RetryFailedCounts = conversions.convertWithContext[C, chronicle.api.v1_5_0.RetryFailedCounts, RetryFailedCounts](context, _from.counts)
        RetryFailedPlan(
                targetprofile,
                selectionhash,
                counts
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#RetryFailedPlan"
  }
}