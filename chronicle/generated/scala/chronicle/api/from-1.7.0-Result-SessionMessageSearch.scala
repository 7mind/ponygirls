import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__SessionMessageSearch__From__1_7_0
    extends AbstractConversion[v1_7_0.Result.SessionMessageSearch, Result.SessionMessageSearch] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Result.SessionMessageSearch
      ): Result.SessionMessageSearch = {
        val result: SessionMessageSearchResult = conversions.convertWithContext[C, v1_7_0.SessionMessageSearchResult, SessionMessageSearchResult](context, _from.result)
        Result.SessionMessageSearch(
                result
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch"
  }
}