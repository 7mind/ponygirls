import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Search__From__1_4_0
    extends AbstractConversion[v1_4_0.Result.Search, Result.Search] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Result.Search
      ): Result.Search = {
        val result: SearchResult = conversions.convertWithContext[C, v1_4_0.SearchResult, SearchResult](context, _from.result)
        Result.Search(
                result
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Search"
  }
}