import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ExpressionHints__From__1_7_0
    extends AbstractConversion[v1_7_0.Operation.ExpressionHints, Operation.ExpressionHints] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Operation.ExpressionHints
      ): Operation.ExpressionHints = {
        val query: ExpressionHintQuery = conversions.convertWithContext[C, v1_7_0.ExpressionHintQuery, ExpressionHintQuery](context, _from.query)
        Operation.ExpressionHints(
                query
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ExpressionHints"
  }
}