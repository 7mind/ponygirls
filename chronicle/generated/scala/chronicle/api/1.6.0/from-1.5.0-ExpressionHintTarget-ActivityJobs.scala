import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintTarget__ActivityJobs__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.ExpressionHintTarget.ActivityJobs, ExpressionHintTarget.ActivityJobs] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.ExpressionHintTarget.ActivityJobs
      ): ExpressionHintTarget.ActivityJobs = {
        val scope: ActivityJobScope = conversions.convertWithContext[C, chronicle.api.v1_5_0.ActivityJobScope, ActivityJobScope](context, _from.scope)
        val collectorid: Option[String] = _from.collectorId.map(e1 => e1)
        ExpressionHintTarget.ActivityJobs(
                scope,
                collectorid
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs"
  }
}