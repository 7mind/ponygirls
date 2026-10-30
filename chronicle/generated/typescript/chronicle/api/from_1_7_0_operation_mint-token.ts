import {Operation_MintToken as api_Operation_MintToken} from './Operation.js'
import {convert__scope__from__1_7_0} from './from_1_7_0_scope.js'
import {Operation_MintToken as MintToken__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__mint_token__from__1_7_0(from: MintToken__1_7_0): api_Operation_MintToken {
    return new api_Operation_MintToken (
        from.name,
        Array.from(from.scopes, item => convert__scope__from__1_7_0(item))
    )
}