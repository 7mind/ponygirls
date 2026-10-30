import {TokenInfo as TokenInfo__1_6_0} from '../v1_6_0/TokenInfo.js'
import {TokenInfo as v1_7_0_TokenInfo} from './TokenInfo.js'
import {convert__scope__from__1_6_0} from './from_1_6_0_scope.js'

export function convert__token_info__from__1_6_0(from: TokenInfo__1_6_0): v1_7_0_TokenInfo {
    return new v1_7_0_TokenInfo (
        from.id,
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_6_0(item)),
        from.createdAt,
        from.revoked
    )
}