import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__RelatedResult__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.RelatedResult, RelatedResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.RelatedResult
      ): RelatedResult = {
        val sessions: List[SearchHit] = _from.sessions.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_5_0.SearchHit, SearchHit](context, e1)).toList
        RelatedResult(
                sessions
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#RelatedResult"
  }
}