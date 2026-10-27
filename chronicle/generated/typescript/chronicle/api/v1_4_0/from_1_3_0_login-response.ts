import {LoginResponse as LoginResponse__1_3_0} from '../v1_3_0/LoginResponse.js'
import {LoginResponse as v1_4_0_LoginResponse} from './LoginResponse.js'
import {convert__user_info__from__1_3_0} from './from_1_3_0_user-info.js'
import {convert__version_info__from__1_3_0} from './from_1_3_0_version-info.js'

export function convert__login_response__from__1_3_0(from: LoginResponse__1_3_0): v1_4_0_LoginResponse {
    return new v1_4_0_LoginResponse (
        convert__user_info__from__1_3_0(from.user),
        convert__version_info__from__1_3_0(from.versions)
    )
}