import {SearchQuery as SearchQuery__1_6_0} from '../v1_6_0/SearchQuery.js'
import {SearchQuery as v1_7_0_SearchQuery} from './SearchQuery.js'
import {convert__search_filter__from__1_6_0} from './from_1_6_0_search-filter.js'
import {convert__search_mode__from__1_6_0} from './from_1_6_0_search-mode.js'

export function convert__search_query__from__1_6_0(from: SearchQuery__1_6_0): v1_7_0_SearchQuery {
    return new v1_7_0_SearchQuery (
        from.query,
        convert__search_mode__from__1_6_0(from.mode),
        convert__search_filter__from__1_6_0(from.filter),
        from.limit,
        from.offset
    )
}