import {Operation_MintToken as MintToken__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_MintToken as v1_6_0_Operation_MintToken} from './Operation.js'
import {convert__scope__from__1_5_0} from './from_1_5_0_scope.js'

export function convert__operation__mint_token__from__1_5_0(from: MintToken__1_5_0): v1_6_0_Operation_MintToken {
    return new v1_6_0_Operation_MintToken (
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_5_0(item))
    )
}