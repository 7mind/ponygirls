import {Result_Status as Status__1_5_0} from '../v1_5_0/Result.js'
import {Result_Status as v1_6_0_Result_Status} from './Result.js'
import {convert__status_result__from__1_5_0} from './from_1_5_0_status-result.js'

export function convert__result__status__from__1_5_0(from: Status__1_5_0): v1_6_0_Result_Status {
    return new v1_6_0_Result_Status (
        convert__status_result__from__1_5_0(from.result)
    )
}