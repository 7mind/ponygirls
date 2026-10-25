import {Operation_RevokeToken as api_Operation_RevokeToken} from './Operation.js'
import {Operation_RevokeToken as RevokeToken__1_0_0} from './v1_0_0/Operation.js'

export function convert__operation__revoke_token__from__1_0_0(from: RevokeToken__1_0_0): api_Operation_RevokeToken {
    return new api_Operation_RevokeToken (
        from.tokenId
    )
}