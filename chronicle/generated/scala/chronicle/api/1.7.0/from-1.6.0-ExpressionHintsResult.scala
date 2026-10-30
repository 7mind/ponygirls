import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintsResult__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.ExpressionHintsResult, ExpressionHintsResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.ExpressionHintsResult
      ): ExpressionHintsResult = {
        val queryhash: String = _from.queryHash
        val observedat: String = _from.observedAt
        val replacestartutf16: Int = _from.replaceStartUtf16
        val replaceendutf16: Int = _from.replaceEndUtf16
        val hints: List[ExpressionHint] = _from.hints.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_6_0.ExpressionHint, ExpressionHint](context, e1)).toList
        val truncated: Boolean = _from.truncated
        ExpressionHintsResult(
                queryhash,
                observedat,
                replacestartutf16,
                replaceendutf16,
                hints,
                truncated
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ExpressionHintsResult"
  }
}