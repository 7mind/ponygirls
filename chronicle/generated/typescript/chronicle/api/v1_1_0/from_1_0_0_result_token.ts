import {Result_Token as Token__1_0_0} from '../v1_0_0/Result.js'
import {Result_Token as v1_1_0_Result_Token} from './Result.js'
import {convert__token_result__from__1_0_0} from './from_1_0_0_token-result.js'

export function convert__result__token__from__1_0_0(from: Token__1_0_0): v1_1_0_Result_Token {
    return new v1_1_0_Result_Token (
        convert__token_result__from__1_0_0(from.result)
    )
}