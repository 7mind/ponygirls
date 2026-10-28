import {Result_Status as Status__1_4_0} from '../v1_4_0/Result.js'
import {Result_Status as v1_5_0_Result_Status} from './Result.js'
import {convert__status_result__from__1_4_0} from './from_1_4_0_status-result.js'

export function convert__result__status__from__1_4_0(from: Status__1_4_0): v1_5_0_Result_Status {
    return new v1_5_0_Result_Status (
        convert__status_result__from__1_4_0(from.result)
    )
}