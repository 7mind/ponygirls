import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ChunksResult__From__1_4_0
    extends AbstractConversion[v1_4_0.ChunksResult, ChunksResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.ChunksResult
      ): ChunksResult = {
        val chunks: List[Chunk] = _from.chunks.map(e1 => conversions.convertWithContext[C, v1_4_0.Chunk, Chunk](context, e1)).toList
        val total: Int = _from.total
        val offset: Int = _from.offset
        val view: ContentView = conversions.convertWithContext[C, v1_4_0.ContentView, ContentView](context, _from.view)
        ChunksResult(
                chunks,
                total,
                offset,
                view
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ChunksResult"
  }
}