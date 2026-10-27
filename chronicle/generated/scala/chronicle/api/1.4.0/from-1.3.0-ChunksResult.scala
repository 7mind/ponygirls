import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ChunksResult__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.ChunksResult, ChunksResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.ChunksResult
      ): ChunksResult = {
        val chunks: List[Chunk] = _from.chunks.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_3_0.Chunk, Chunk](context, e1)).toList
        val total: Int = _from.total
        val offset: Int = _from.offset
        val view: ContentView = conversions.convertWithContext[C, chronicle.api.v1_3_0.ContentView, ContentView](context, _from.view)
        ChunksResult(
                chunks,
                total,
                offset,
                view
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#ChunksResult"
  }
}