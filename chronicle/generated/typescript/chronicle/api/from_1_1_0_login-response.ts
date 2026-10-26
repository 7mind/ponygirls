import {LoginResponse as api_LoginResponse} from './LoginResponse.js'
import {convert__user_info__from__1_1_0} from './from_1_1_0_user-info.js'
import {convert__version_info__from__1_1_0} from './from_1_1_0_version-info.js'
import {LoginResponse as LoginResponse__1_1_0} from './v1_1_0/LoginResponse.js'

export function convert__login_response__from__1_1_0(from: LoginResponse__1_1_0): api_LoginResponse {
    return new api_LoginResponse (
        convert__user_info__from__1_1_0(from.user),
        convert__version_info__from__1_1_0(from.versions)
    )
}