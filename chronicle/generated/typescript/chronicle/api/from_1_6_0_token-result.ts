import {TokenResult as api_TokenResult} from './TokenResult.js'
import {convert__token_info__from__1_6_0} from './from_1_6_0_token-info.js'
import {TokenResult as TokenResult__1_6_0} from './v1_6_0/TokenResult.js'

export function convert__token_result__from__1_6_0(from: TokenResult__1_6_0): api_TokenResult {
    return new api_TokenResult (
        convert__token_info__from__1_6_0(from.token),
        from.secret
    )
}