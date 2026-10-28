import {Operation_RevokeToken as api_Operation_RevokeToken} from './Operation.js'
import {Operation_RevokeToken as RevokeToken__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__revoke_token__from__1_6_0(from: RevokeToken__1_6_0): api_Operation_RevokeToken {
    return new api_Operation_RevokeToken (
        from.tokenId
    )
}