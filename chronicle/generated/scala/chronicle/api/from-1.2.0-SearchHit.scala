import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SearchHit__From__1_2_0
    extends AbstractConversion[v1_2_0.SearchHit, SearchHit] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.SearchHit
      ): SearchHit = {
        val session: SessionInfo = conversions.convertWithContext[C, v1_2_0.SessionInfo, SessionInfo](context, _from.session)
        val chunks: List[Chunk] = _from.chunks.map(e1 => conversions.convertWithContext[C, v1_2_0.Chunk, Chunk](context, e1)).toList
        val score: Double = _from.score
        SearchHit(
                session,
                chunks,
                score
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#SearchHit"
  }
}