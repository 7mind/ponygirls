import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__SessionMessageSearch__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.Result.SessionMessageSearch, Result.SessionMessageSearch] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.Result.SessionMessageSearch
      ): Result.SessionMessageSearch = {
        val result: SessionMessageSearchResult = conversions.convertWithContext[C, chronicle.api.v1_6_0.SessionMessageSearchResult, SessionMessageSearchResult](context, _from.result)
        Result.SessionMessageSearch(
                result
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#SessionMessageSearch"
  }
}