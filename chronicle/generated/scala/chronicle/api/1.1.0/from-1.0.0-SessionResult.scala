import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SessionResult__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.SessionResult, SessionResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.SessionResult
      ): SessionResult = {
        val session: SessionInfo = conversions.convertWithContext[C, chronicle.api.v1_0_0.SessionInfo, SessionInfo](context, _from.session)
        val chunks: List[Chunk] = _from.chunks.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_0_0.Chunk, Chunk](context, e1)).toList
        SessionResult(
                session,
                chunks
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#SessionResult"
  }
}