import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SessionMessageSearchResult__From__1_7_0
    extends AbstractConversion[v1_7_0.SessionMessageSearchResult, SessionMessageSearchResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.SessionMessageSearchResult
      ): SessionMessageSearchResult = {
        val view: ContentView = conversions.convertWithContext[C, v1_7_0.ContentView, ContentView](context, _from.view)
        val hits: List[MessageSearchHit] = _from.hits.map(e1 => conversions.convertWithContext[C, v1_7_0.MessageSearchHit, MessageSearchHit](context, e1)).toList
        val nextcursor: Option[String] = _from.nextCursor.map(e1 => e1)
        SessionMessageSearchResult(
                view,
                hits,
                nextcursor
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#SessionMessageSearchResult"
  }
}