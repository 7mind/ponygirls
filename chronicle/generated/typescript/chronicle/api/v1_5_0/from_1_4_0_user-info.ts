import {UserInfo as UserInfo__1_4_0} from '../v1_4_0/UserInfo.js'
import {UserInfo as v1_5_0_UserInfo} from './UserInfo.js'
import {convert__scope__from__1_4_0} from './from_1_4_0_scope.js'

export function convert__user_info__from__1_4_0(from: UserInfo__1_4_0): v1_5_0_UserInfo {
    return new v1_5_0_UserInfo (
        from.id,
        from.login,
        Array.from(from.scopes, item => convert__scope__from__1_4_0(item))
    )
}