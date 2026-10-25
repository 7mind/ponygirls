import {Result_Related as api_Result_Related} from './Result.js'
import {convert__related_result__from__1_0_0} from './from_1_0_0_related-result.js'
import {Result_Related as Related__1_0_0} from './v1_0_0/Result.js'

export function convert__result__related__from__1_0_0(from: Related__1_0_0): api_Result_Related {
    return new api_Result_Related (
        convert__related_result__from__1_0_0(from.result)
    )
}