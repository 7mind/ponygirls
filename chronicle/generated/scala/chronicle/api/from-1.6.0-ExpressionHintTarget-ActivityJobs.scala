import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintTarget__ActivityJobs__From__1_6_0
    extends AbstractConversion[v1_6_0.ExpressionHintTarget.ActivityJobs, ExpressionHintTarget.ActivityJobs] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.ExpressionHintTarget.ActivityJobs
      ): ExpressionHintTarget.ActivityJobs = {
        val scope: ActivityJobScope = conversions.convertWithContext[C, v1_6_0.ActivityJobScope, ActivityJobScope](context, _from.scope)
        val collectorid: Option[String] = _from.collectorId.map(e1 => e1)
        ExpressionHintTarget.ActivityJobs(
                scope,
                collectorid
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs"
  }
}