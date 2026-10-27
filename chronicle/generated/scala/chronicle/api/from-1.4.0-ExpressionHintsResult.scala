import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintsResult__From__1_4_0
    extends AbstractConversion[v1_4_0.ExpressionHintsResult, ExpressionHintsResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.ExpressionHintsResult
      ): ExpressionHintsResult = {
        val queryhash: String = _from.queryHash
        val observedat: String = _from.observedAt
        val replacestartutf16: Int = _from.replaceStartUtf16
        val replaceendutf16: Int = _from.replaceEndUtf16
        val hints: List[ExpressionHint] = _from.hints.map(e1 => conversions.convertWithContext[C, v1_4_0.ExpressionHint, ExpressionHint](context, e1)).toList
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
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ExpressionHintsResult"
  }
}