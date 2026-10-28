import {SearchResult as SearchResult__1_4_0} from '../v1_4_0/SearchResult.js'
import {SearchResult as v1_5_0_SearchResult} from './SearchResult.js'
import {convert__search_count_scope__from__1_4_0} from './from_1_4_0_search-count-scope.js'
import {convert__search_hit__from__1_4_0} from './from_1_4_0_search-hit.js'

export function convert__search_result__from__1_4_0(from: SearchResult__1_4_0): v1_5_0_SearchResult {
    return new v1_5_0_SearchResult (
        Array.from(from.hits, item => convert__search_hit__from__1_4_0(item)),
        from.total,
        convert__search_count_scope__from__1_4_0(from.countScope),
        from.rankingLimit
    )
}