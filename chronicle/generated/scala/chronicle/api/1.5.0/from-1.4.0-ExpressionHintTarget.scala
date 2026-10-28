import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintTarget__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.ExpressionHintTarget, ExpressionHintTarget] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_4_0.ExpressionHintTarget
      ): ExpressionHintTarget = from match {
        case x: chronicle.api.v1_4_0.ExpressionHintTarget.Archive => conversions.convertWithContext[C, chronicle.api.v1_4_0.ExpressionHintTarget.Archive, ExpressionHintTarget.Archive](context, x)
        case x: chronicle.api.v1_4_0.ExpressionHintTarget.ActivityCollectors => conversions.convertWithContext[C, chronicle.api.v1_4_0.ExpressionHintTarget.ActivityCollectors, ExpressionHintTarget.ActivityCollectors](context, x)
        case x: chronicle.api.v1_4_0.ExpressionHintTarget.ActivityJobs => conversions.convertWithContext[C, chronicle.api.v1_4_0.ExpressionHintTarget.ActivityJobs, ExpressionHintTarget.ActivityJobs](context, x)
        case other => throw new IllegalArgumentException(s"Bad input: $other")
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ExpressionHintTarget"
  }
}