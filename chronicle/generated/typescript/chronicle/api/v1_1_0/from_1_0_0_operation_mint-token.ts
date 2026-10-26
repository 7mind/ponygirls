import {Operation_MintToken as MintToken__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_MintToken as v1_1_0_Operation_MintToken} from './Operation.js'
import {convert__scope__from__1_0_0} from './from_1_0_0_scope.js'

export function convert__operation__mint_token__from__1_0_0(from: MintToken__1_0_0): v1_1_0_Operation_MintToken {
    return new v1_1_0_Operation_MintToken (
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_0_0(item))
    )
}