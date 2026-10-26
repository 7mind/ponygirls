import {Operation_RevokeToken as RevokeToken__1_2_0} from '../v1_2_0/Operation.js'
import {Operation_RevokeToken as v1_3_0_Operation_RevokeToken} from './Operation.js'

export function convert__operation__revoke_token__from__1_2_0(from: RevokeToken__1_2_0): v1_3_0_Operation_RevokeToken {
    return new v1_3_0_Operation_RevokeToken (
        from.tokenId
    )
}