import {Operation_RevokeToken as RevokeToken__1_1_0} from '../v1_1_0/Operation.js'
import {Operation_RevokeToken as v1_2_0_Operation_RevokeToken} from './Operation.js'

export function convert__operation__revoke_token__from__1_1_0(from: RevokeToken__1_1_0): v1_2_0_Operation_RevokeToken {
    return new v1_2_0_Operation_RevokeToken (
        from.tokenId
    )
}