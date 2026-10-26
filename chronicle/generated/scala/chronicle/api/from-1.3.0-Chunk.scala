import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Chunk__From__1_3_0
    extends AbstractConversion[v1_3_0.Chunk, Chunk] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.Chunk
      ): Chunk = {
        val id: UUID = _from.id
        val sessionid: UUID = _from.sessionId
        val text: String = _from.text
        val summary: String = _from.summary
        val tags: List[String] = _from.tags.map(e1 => e1).toList
        val spans: List[Span] = _from.spans.map(e1 => conversions.convertWithContext[C, v1_3_0.Span, Span](context, e1)).toList
        val score: Double = _from.score
        Chunk(
                id,
                sessionid,
                text,
                summary,
                tags,
                spans,
                score
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#Chunk"
  }
}