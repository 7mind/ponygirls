import {UserInfo as UserInfo__1_5_0} from '../v1_5_0/UserInfo.js'
import {UserInfo as v1_6_0_UserInfo} from './UserInfo.js'
import {convert__scope__from__1_5_0} from './from_1_5_0_scope.js'

export function convert__user_info__from__1_5_0(from: UserInfo__1_5_0): v1_6_0_UserInfo {
    return new v1_6_0_UserInfo (
        from.id,
        from.login,
        Array.from(from.scopes, item => convert__scope__from__1_5_0(item))
    )
}