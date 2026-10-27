import {Result_Groups as Groups__1_3_0} from '../v1_3_0/Result.js'
import {Result_Groups as v1_4_0_Result_Groups} from './Result.js'
import {convert__groups_result__from__1_3_0} from './from_1_3_0_groups-result.js'

export function convert__result__groups__from__1_3_0(from: Groups__1_3_0): v1_4_0_Result_Groups {
    return new v1_4_0_Result_Groups (
        convert__groups_result__from__1_3_0(from.result)
    )
}