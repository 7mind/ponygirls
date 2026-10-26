import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RelatedResult__From__1_3_0
    extends AbstractConversion[v1_3_0.RelatedResult, RelatedResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.RelatedResult
      ): RelatedResult = {
        val sessions: List[SearchHit] = _from.sessions.map(e1 => conversions.convertWithContext[C, v1_3_0.SearchHit, SearchHit](context, e1)).toList
        RelatedResult(
                sessions
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#RelatedResult"
  }
}