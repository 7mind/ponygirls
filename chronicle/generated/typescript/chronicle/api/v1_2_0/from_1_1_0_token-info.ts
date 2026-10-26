import {TokenInfo as TokenInfo__1_1_0} from '../v1_1_0/TokenInfo.js'
import {TokenInfo as v1_2_0_TokenInfo} from './TokenInfo.js'
import {convert__scope__from__1_1_0} from './from_1_1_0_scope.js'

export function convert__token_info__from__1_1_0(from: TokenInfo__1_1_0): v1_2_0_TokenInfo {
    return new v1_2_0_TokenInfo (
        from.id,
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_1_0(item)),
        from.createdAt,
        from.revoked
    )
}