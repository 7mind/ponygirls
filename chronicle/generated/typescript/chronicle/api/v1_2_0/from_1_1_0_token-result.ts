import {TokenResult as TokenResult__1_1_0} from '../v1_1_0/TokenResult.js'
import {TokenResult as v1_2_0_TokenResult} from './TokenResult.js'
import {convert__token_info__from__1_1_0} from './from_1_1_0_token-info.js'

export function convert__token_result__from__1_1_0(from: TokenResult__1_1_0): v1_2_0_TokenResult {
    return new v1_2_0_TokenResult (
        convert__token_info__from__1_1_0(from.token),
        from.secret
    )
}