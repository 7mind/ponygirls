import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintQuery__From__1_4_0
    extends AbstractConversion[v1_4_0.ExpressionHintQuery, ExpressionHintQuery] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.ExpressionHintQuery
      ): ExpressionHintQuery = {
        val target: ExpressionHintTarget = conversions.convertWithContext[C, v1_4_0.ExpressionHintTarget, ExpressionHintTarget](context, _from.target)
        val expression: String = _from.expression
        val caretutf16: Int = _from.caretUtf16
        val limit: Int = _from.limit
        ExpressionHintQuery(
                target,
                expression,
                caretutf16,
                limit
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ExpressionHintQuery"
  }
}