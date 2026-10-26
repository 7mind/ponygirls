import {TokensResult as api_TokensResult} from './TokensResult.js'
import {convert__listed_token__from__1_3_0} from './from_1_3_0_listed-token.js'
import {TokensResult as TokensResult__1_3_0} from './v1_3_0/TokensResult.js'

export function convert__tokens_result__from__1_3_0(from: TokensResult__1_3_0): api_TokensResult {
    return new api_TokensResult (
        Array.from(from.tokens, item => convert__listed_token__from__1_3_0(item))
    )
}