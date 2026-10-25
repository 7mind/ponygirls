import {TokensResult as api_TokensResult} from './TokensResult.js'
import {convert__token_info__from__1_0_0} from './from_1_0_0_token-info.js'
import {TokensResult as TokensResult__1_0_0} from './v1_0_0/TokensResult.js'

export function convert__tokens_result__from__1_0_0(from: TokensResult__1_0_0): api_TokensResult {
    return new api_TokensResult (
        Array.from(from.tokens, item => convert__token_info__from__1_0_0(item))
    )
}