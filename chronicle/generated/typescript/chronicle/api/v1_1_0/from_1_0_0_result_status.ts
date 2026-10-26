import {Result_Status as Status__1_0_0} from '../v1_0_0/Result.js'
import {Result_Status as v1_1_0_Result_Status} from './Result.js'
import {convert__status_result__from__1_0_0} from './from_1_0_0_status-result.js'

export function convert__result__status__from__1_0_0(from: Status__1_0_0): v1_1_0_Result_Status {
    return new v1_1_0_Result_Status (
        convert__status_result__from__1_0_0(from.result)
    )
}