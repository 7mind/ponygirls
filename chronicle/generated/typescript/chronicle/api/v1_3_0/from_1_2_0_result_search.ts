import {Result_Search as Search__1_2_0} from '../v1_2_0/Result.js'
import {Result_Search as v1_3_0_Result_Search} from './Result.js'
import {convert__search_result__from__1_2_0} from './from_1_2_0_search-result.js'

export function convert__result__search__from__1_2_0(from: Search__1_2_0): v1_3_0_Result_Search {
    return new v1_3_0_Result_Search (
        convert__search_result__from__1_2_0(from.result)
    )
}