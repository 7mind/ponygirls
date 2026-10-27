import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintTarget__From__1_4_0
    extends AbstractConversion[v1_4_0.ExpressionHintTarget, ExpressionHintTarget] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_4_0.ExpressionHintTarget
      ): ExpressionHintTarget = from match {
        case x: v1_4_0.ExpressionHintTarget.Archive => conversions.convertWithContext[C, v1_4_0.ExpressionHintTarget.Archive, ExpressionHintTarget.Archive](context, x)
        case x: v1_4_0.ExpressionHintTarget.ActivityCollectors => conversions.convertWithContext[C, v1_4_0.ExpressionHintTarget.ActivityCollectors, ExpressionHintTarget.ActivityCollectors](context, x)
        case x: v1_4_0.ExpressionHintTarget.ActivityJobs => conversions.convertWithContext[C, v1_4_0.ExpressionHintTarget.ActivityJobs, ExpressionHintTarget.ActivityJobs](context, x)
        case other => throw new IllegalArgumentException(s"Bad input: $other")
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ExpressionHintTarget"
  }
}