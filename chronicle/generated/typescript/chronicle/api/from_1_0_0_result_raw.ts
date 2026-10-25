import {Result_Raw as api_Result_Raw} from './Result.js'
import {convert__raw_result__from__1_0_0} from './from_1_0_0_raw-result.js'
import {Result_Raw as Raw__1_0_0} from './v1_0_0/Result.js'

export function convert__result__raw__from__1_0_0(from: Raw__1_0_0): api_Result_Raw {
    return new api_Result_Raw (
        convert__raw_result__from__1_0_0(from.result)
    )
}