import {Result_Token as api_Result_Token} from './Result.js'
import {convert__token_result__from__1_3_0} from './from_1_3_0_token-result.js'
import {Result_Token as Token__1_3_0} from './v1_3_0/Result.js'

export function convert__result__token__from__1_3_0(from: Token__1_3_0): api_Result_Token {
    return new api_Result_Token (
        convert__token_result__from__1_3_0(from.result)
    )
}