package chronicle
import chronicle.api.*
import baboon.runtime.shared.AbstractBaboonConversions

final class SearchResultFromV1 extends Convert__SearchResult__From__1_0_0 {
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: chronicle.api.v1_0_0.SearchResult): SearchResult =
    SearchResult(from.hits.map(hit => conversions.convertWithContext[C,chronicle.api.v1_0_0.SearchHit,SearchHit](context,hit)),from.total,SearchCountScope.ExactMatches,None)
}
