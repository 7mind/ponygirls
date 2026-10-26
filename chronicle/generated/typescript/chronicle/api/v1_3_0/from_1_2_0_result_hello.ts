import {Result_Hello as Hello__1_2_0} from '../v1_2_0/Result.js'
import {Result_Hello as v1_3_0_Result_Hello} from './Result.js'
import {convert__user_info__from__1_2_0} from './from_1_2_0_user-info.js'
import {convert__version_info__from__1_2_0} from './from_1_2_0_version-info.js'

export function convert__result__hello__from__1_2_0(from: Hello__1_2_0): v1_3_0_Result_Hello {
    return new v1_3_0_Result_Hello (
        convert__version_info__from__1_2_0(from.versions),
        convert__user_info__from__1_2_0(from.user)
    )
}