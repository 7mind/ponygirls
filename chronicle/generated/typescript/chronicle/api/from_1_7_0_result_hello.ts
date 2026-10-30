import {Result_Hello as api_Result_Hello} from './Result.js'
import {convert__user_info__from__1_7_0} from './from_1_7_0_user-info.js'
import {convert__version_info__from__1_7_0} from './from_1_7_0_version-info.js'
import {Result_Hello as Hello__1_7_0} from './v1_7_0/Result.js'

export function convert__result__hello__from__1_7_0(from: Hello__1_7_0): api_Result_Hello {
    return new api_Result_Hello (
        convert__version_info__from__1_7_0(from.versions),
        convert__user_info__from__1_7_0(from.user)
    )
}