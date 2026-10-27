import {Result_Related as Related__1_3_0} from '../v1_3_0/Result.js'
import {Result_Related as v1_4_0_Result_Related} from './Result.js'
import {convert__related_result__from__1_3_0} from './from_1_3_0_related-result.js'

export function convert__result__related__from__1_3_0(from: Related__1_3_0): v1_4_0_Result_Related {
    return new v1_4_0_Result_Related (
        convert__related_result__from__1_3_0(from.result)
    )
}