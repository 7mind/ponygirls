import {TokensResult as TokensResult__1_6_0} from '../v1_6_0/TokensResult.js'
import {TokensResult as v1_7_0_TokensResult} from './TokensResult.js'
import {convert__listed_token__from__1_6_0} from './from_1_6_0_listed-token.js'

export function convert__tokens_result__from__1_6_0(from: TokensResult__1_6_0): v1_7_0_TokensResult {
    return new v1_7_0_TokensResult (
        Array.from(from.tokens, item => convert__listed_token__from__1_6_0(item))
    )
}