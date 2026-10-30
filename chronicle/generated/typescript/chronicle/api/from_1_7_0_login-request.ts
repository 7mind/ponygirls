import {LoginRequest as api_LoginRequest} from './LoginRequest.js'
import {LoginRequest as LoginRequest__1_7_0} from './v1_7_0/LoginRequest.js'

export function convert__login_request__from__1_7_0(from: LoginRequest__1_7_0): api_LoginRequest {
    return new api_LoginRequest (
        from.login,
        from.password
    )
}