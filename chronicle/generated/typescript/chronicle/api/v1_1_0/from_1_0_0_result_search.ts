import { convert__search_result__from__1_0_0 } from '../../../../../protocol/typescript/conversions.js';
import {Result_Search as Search__1_0_0} from '../v1_0_0/Result.js'
import {Result_Search as v1_1_0_Result_Search} from './Result.js'

export function convert__result__search__from__1_0_0(from: Search__1_0_0): v1_1_0_Result_Search {
    return new v1_1_0_Result_Search (
        convert__search_result__from__1_0_0(from.result)
    )
}