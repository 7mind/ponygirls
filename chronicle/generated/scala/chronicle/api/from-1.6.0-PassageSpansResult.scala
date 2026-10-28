import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__PassageSpansResult__From__1_6_0
    extends AbstractConversion[v1_6_0.PassageSpansResult, PassageSpansResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.PassageSpansResult
      ): PassageSpansResult = {
        val view: ContentView = conversions.convertWithContext[C, v1_6_0.ContentView, ContentView](context, _from.view)
        val passageid: UUID = _from.passageId
        val spans: List[PassageSourceSpan] = _from.spans.map(e1 => conversions.convertWithContext[C, v1_6_0.PassageSourceSpan, PassageSourceSpan](context, e1)).toList
        val total: Long = _from.total
        val offset: Int = _from.offset
        PassageSpansResult(
                view,
                passageid,
                spans,
                total,
                offset
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#PassageSpansResult"
  }
}