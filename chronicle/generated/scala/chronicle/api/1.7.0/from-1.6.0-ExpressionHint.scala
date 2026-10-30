import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHint__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.ExpressionHint, ExpressionHint] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.ExpressionHint
      ): ExpressionHint = {
        val kind: ExpressionHintKind = conversions.convertWithContext[C, chronicle.api.v1_6_0.ExpressionHintKind, ExpressionHintKind](context, _from.kind)
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
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ExpressionHint"
  }
}