import {Operation_RevokeToken as RevokeToken__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_RevokeToken as v1_1_0_Operation_RevokeToken} from './Operation.js'

export function convert__operation__revoke_token__from__1_0_0(from: RevokeToken__1_0_0): v1_1_0_Operation_RevokeToken {
    return new v1_1_0_Operation_RevokeToken (
        from.tokenId
    )
}