import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SearchQuery__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.SearchQuery, SearchQuery] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.SearchQuery
      ): SearchQuery = {
        val query: String = _from.query
        val mode: SearchMode = conversions.convertWithContext[C, chronicle.api.v1_3_0.SearchMode, SearchMode](context, _from.mode)
        val filter: SearchFilter = conversions.convertWithContext[C, chronicle.api.v1_3_0.SearchFilter, SearchFilter](context, _from.filter)
        val limit: Int = _from.limit
        val offset: Int = _from.offset
        SearchQuery(
                query,
                mode,
                filter,
                limit,
                offset
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#SearchQuery"
  }
}