import {SearchResult as api_SearchResult} from './SearchResult.js'
import {convert__search_count_scope__from__1_2_0} from './from_1_2_0_search-count-scope.js'
import {convert__search_hit__from__1_2_0} from './from_1_2_0_search-hit.js'
import {SearchResult as SearchResult__1_2_0} from './v1_2_0/SearchResult.js'

export function convert__search_result__from__1_2_0(from: SearchResult__1_2_0): api_SearchResult {
    return new api_SearchResult (
        Array.from(from.hits, item => convert__search_hit__from__1_2_0(item)),
        from.total,
        convert__search_count_scope__from__1_2_0(from.countScope),
        from.rankingLimit
    )
}