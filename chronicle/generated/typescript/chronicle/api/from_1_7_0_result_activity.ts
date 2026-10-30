import {Result_Activity as api_Result_Activity} from './Result.js'
import {convert__activity_result__from__1_7_0} from './from_1_7_0_activity-result.js'
import {Result_Activity as Activity__1_7_0} from './v1_7_0/Result.js'

export function convert__result__activity__from__1_7_0(from: Activity__1_7_0): api_Result_Activity {
    return new api_Result_Activity (
        convert__activity_result__from__1_7_0(from.result)
    )
}