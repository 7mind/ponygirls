import {Result_Activity as Activity__1_3_0} from '../v1_3_0/Result.js'
import {Result_Activity as v1_4_0_Result_Activity} from './Result.js'
import {convert__activity_result__from__1_3_0} from './from_1_3_0_activity-result.js'

export function convert__result__activity__from__1_3_0(from: Activity__1_3_0): v1_4_0_Result_Activity {
    return new v1_4_0_Result_Activity (
        convert__activity_result__from__1_3_0(from.result)
    )
}