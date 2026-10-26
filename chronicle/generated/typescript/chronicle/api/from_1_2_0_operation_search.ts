import {Operation_Search as api_Operation_Search} from './Operation.js'
import {convert__search_query__from__1_2_0} from './from_1_2_0_search-query.js'
import {Operation_Search as Search__1_2_0} from './v1_2_0/Operation.js'

export function convert__operation__search__from__1_2_0(from: Search__1_2_0): api_Operation_Search {
    return new api_Operation_Search (
        convert__search_query__from__1_2_0(from.query)
    )
}