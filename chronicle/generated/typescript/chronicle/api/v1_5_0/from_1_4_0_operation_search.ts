import {Operation_Search as Search__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_Search as v1_5_0_Operation_Search} from './Operation.js'
import {convert__search_query__from__1_4_0} from './from_1_4_0_search-query.js'

export function convert__operation__search__from__1_4_0(from: Search__1_4_0): v1_5_0_Operation_Search {
    return new v1_5_0_Operation_Search (
        convert__search_query__from__1_4_0(from.query)
    )
}