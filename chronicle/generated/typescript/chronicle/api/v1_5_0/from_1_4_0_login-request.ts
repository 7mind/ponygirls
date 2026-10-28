import {LoginRequest as LoginRequest__1_4_0} from '../v1_4_0/LoginRequest.js'
import {LoginRequest as v1_5_0_LoginRequest} from './LoginRequest.js'

export function convert__login_request__from__1_4_0(from: LoginRequest__1_4_0): v1_5_0_LoginRequest {
    return new v1_5_0_LoginRequest (
        from.login,
        from.password
    )
}