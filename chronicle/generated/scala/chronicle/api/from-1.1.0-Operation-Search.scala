import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Search__From__1_1_0
    extends AbstractConversion[v1_1_0.Operation.Search, Operation.Search] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Operation.Search
      ): Operation.Search = {
        val query: SearchQuery = conversions.convertWithContext[C, v1_1_0.SearchQuery, SearchQuery](context, _from.query)
        Operation.Search(
                query
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Search"
  }
}