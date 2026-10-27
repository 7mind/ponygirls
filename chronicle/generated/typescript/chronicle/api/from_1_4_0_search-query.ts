import {SearchQuery as api_SearchQuery} from './SearchQuery.js'
import {convert__search_filter__from__1_4_0} from './from_1_4_0_search-filter.js'
import {convert__search_mode__from__1_4_0} from './from_1_4_0_search-mode.js'
import {SearchQuery as SearchQuery__1_4_0} from './v1_4_0/SearchQuery.js'

export function convert__search_query__from__1_4_0(from: SearchQuery__1_4_0): api_SearchQuery {
    return new api_SearchQuery (
        from.query,
        convert__search_mode__from__1_4_0(from.mode),
        convert__search_filter__from__1_4_0(from.filter),
        from.limit,
        from.offset
    )
}