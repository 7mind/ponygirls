import {UserInfo as api_UserInfo} from './UserInfo.js'
import {convert__scope__from__1_2_0} from './from_1_2_0_scope.js'
import {UserInfo as UserInfo__1_2_0} from './v1_2_0/UserInfo.js'

export function convert__user_info__from__1_2_0(from: UserInfo__1_2_0): api_UserInfo {
    return new api_UserInfo (
        from.id,
        from.login,
        Array.from(from.scopes, item => convert__scope__from__1_2_0(item))
    )
}