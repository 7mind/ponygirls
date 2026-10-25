import {Result_Groups as api_Result_Groups} from './Result.js'
import {convert__groups_result__from__1_0_0} from './from_1_0_0_groups-result.js'
import {Result_Groups as Groups__1_0_0} from './v1_0_0/Result.js'

export function convert__result__groups__from__1_0_0(from: Groups__1_0_0): api_Result_Groups {
    return new api_Result_Groups (
        convert__groups_result__from__1_0_0(from.result)
    )
}