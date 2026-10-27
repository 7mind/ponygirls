import {SearchQuery as SearchQuery__1_3_0} from '../v1_3_0/SearchQuery.js'
import {SearchQuery as v1_4_0_SearchQuery} from './SearchQuery.js'
import {convert__search_filter__from__1_3_0} from './from_1_3_0_search-filter.js'
import {convert__search_mode__from__1_3_0} from './from_1_3_0_search-mode.js'

export function convert__search_query__from__1_3_0(from: SearchQuery__1_3_0): v1_4_0_SearchQuery {
    return new v1_4_0_SearchQuery (
        from.query,
        convert__search_mode__from__1_3_0(from.mode),
        convert__search_filter__from__1_3_0(from.filter),
        from.limit,
        from.offset
    )
}