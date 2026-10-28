import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__PassagesResult__From__1_6_0
    extends AbstractConversion[v1_6_0.PassagesResult, PassagesResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.PassagesResult
      ): PassagesResult = {
        val view: ContentView = conversions.convertWithContext[C, v1_6_0.ContentView, ContentView](context, _from.view)
        val format: PassageFormat = conversions.convertWithContext[C, v1_6_0.PassageFormat, PassageFormat](context, _from.format)
        val passages: List[PassageInfo] = _from.passages.map(e1 => conversions.convertWithContext[C, v1_6_0.PassageInfo, PassageInfo](context, e1)).toList
        val total: Long = _from.total
        val offset: Int = _from.offset
        PassagesResult(
                view,
                format,
                passages,
                total,
                offset
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#PassagesResult"
  }
}