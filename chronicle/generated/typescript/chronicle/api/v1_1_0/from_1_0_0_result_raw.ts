import {Result_Raw as Raw__1_0_0} from '../v1_0_0/Result.js'
import {Result_Raw as v1_1_0_Result_Raw} from './Result.js'
import {convert__raw_result__from__1_0_0} from './from_1_0_0_raw-result.js'

export function convert__result__raw__from__1_0_0(from: Raw__1_0_0): v1_1_0_Result_Raw {
    return new v1_1_0_Result_Raw (
        convert__raw_result__from__1_0_0(from.result)
    )
}