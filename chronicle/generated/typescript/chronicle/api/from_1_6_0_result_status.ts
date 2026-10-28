import {Result_Status as api_Result_Status} from './Result.js'
import {convert__status_result__from__1_6_0} from './from_1_6_0_status-result.js'
import {Result_Status as Status__1_6_0} from './v1_6_0/Result.js'

export function convert__result__status__from__1_6_0(from: Status__1_6_0): api_Result_Status {
    return new api_Result_Status (
        convert__status_result__from__1_6_0(from.result)
    )
}