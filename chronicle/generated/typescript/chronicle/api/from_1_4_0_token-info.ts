import {TokenInfo as api_TokenInfo} from './TokenInfo.js'
import {convert__scope__from__1_4_0} from './from_1_4_0_scope.js'
import {TokenInfo as TokenInfo__1_4_0} from './v1_4_0/TokenInfo.js'

export function convert__token_info__from__1_4_0(from: TokenInfo__1_4_0): api_TokenInfo {
    return new api_TokenInfo (
        from.id,
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_4_0(item)),
        from.createdAt,
        from.revoked
    )
}