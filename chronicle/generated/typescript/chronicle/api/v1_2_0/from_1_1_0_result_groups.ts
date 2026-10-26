import {Result_Groups as Groups__1_1_0} from '../v1_1_0/Result.js'
import {Result_Groups as v1_2_0_Result_Groups} from './Result.js'
import {convert__groups_result__from__1_1_0} from './from_1_1_0_groups-result.js'

export function convert__result__groups__from__1_1_0(from: Groups__1_1_0): v1_2_0_Result_Groups {
    return new v1_2_0_Result_Groups (
        convert__groups_result__from__1_1_0(from.result)
    )
}