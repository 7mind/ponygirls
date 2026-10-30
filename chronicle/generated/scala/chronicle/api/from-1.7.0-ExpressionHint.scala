import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHint__From__1_7_0
    extends AbstractConversion[v1_7_0.ExpressionHint, ExpressionHint] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.ExpressionHint
      ): ExpressionHint = {
        val kind: ExpressionHintKind = conversions.convertWithContext[C, v1_7_0.ExpressionHintKind, ExpressionHintKind](context, _from.kind)
        val label: String = _from.label
        val inserttext: String = _from.insertText
        val caretoffsetutf16: Int = _from.caretOffsetUtf16
        ExpressionHint(
                kind,
                label,
                inserttext,
                caretoffsetutf16
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#ExpressionHint"
  }
}