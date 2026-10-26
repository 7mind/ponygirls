import {TokensResult as TokensResult__1_0_0} from '../v1_0_0/TokensResult.js'
import {TokensResult as v1_1_0_TokensResult} from './TokensResult.js'
import {convert__token_info__from__1_0_0} from './from_1_0_0_token-info.js'

export function convert__tokens_result__from__1_0_0(from: TokensResult__1_0_0): v1_1_0_TokensResult {
    return new v1_1_0_TokensResult (
        Array.from(from.tokens, item => convert__token_info__from__1_0_0(item))
    )
}