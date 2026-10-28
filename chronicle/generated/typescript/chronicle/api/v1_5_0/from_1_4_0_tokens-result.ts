import {TokensResult as TokensResult__1_4_0} from '../v1_4_0/TokensResult.js'
import {TokensResult as v1_5_0_TokensResult} from './TokensResult.js'
import {convert__listed_token__from__1_4_0} from './from_1_4_0_listed-token.js'

export function convert__tokens_result__from__1_4_0(from: TokensResult__1_4_0): v1_5_0_TokensResult {
    return new v1_5_0_TokensResult (
        Array.from(from.tokens, item => convert__listed_token__from__1_4_0(item))
    )
}