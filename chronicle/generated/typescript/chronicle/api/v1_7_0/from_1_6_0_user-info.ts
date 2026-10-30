import {UserInfo as UserInfo__1_6_0} from '../v1_6_0/UserInfo.js'
import {UserInfo as v1_7_0_UserInfo} from './UserInfo.js'
import {convert__scope__from__1_6_0} from './from_1_6_0_scope.js'

export function convert__user_info__from__1_6_0(from: UserInfo__1_6_0): v1_7_0_UserInfo {
    return new v1_7_0_UserInfo (
        from.id,
        from.login,
        Array.from(from.scopes, item => convert__scope__from__1_6_0(item))
    )
}