import {Result_Search as api_Result_Search} from './Result.js'
import {convert__search_result__from__1_1_0} from './from_1_1_0_search-result.js'
import {Result_Search as Search__1_1_0} from './v1_1_0/Result.js'

export function convert__result__search__from__1_1_0(from: Search__1_1_0): api_Result_Search {
    return new api_Result_Search (
        convert__search_result__from__1_1_0(from.result)
    )
}