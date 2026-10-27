import {Operation_MintToken as MintToken__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_MintToken as v1_4_0_Operation_MintToken} from './Operation.js'
import {convert__scope__from__1_3_0} from './from_1_3_0_scope.js'

export function convert__operation__mint_token__from__1_3_0(from: MintToken__1_3_0): v1_4_0_Operation_MintToken {
    return new v1_4_0_Operation_MintToken (
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_3_0(item))
    )
}