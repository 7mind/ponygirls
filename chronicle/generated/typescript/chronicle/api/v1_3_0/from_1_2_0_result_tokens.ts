import {Result_Tokens as Tokens__1_2_0} from '../v1_2_0/Result.js'
import {Result_Tokens as v1_3_0_Result_Tokens} from './Result.js'
import {convert__tokens_result__from__1_2_0} from './from_1_2_0_tokens-result.js'

export function convert__result__tokens__from__1_2_0(from: Tokens__1_2_0): v1_3_0_Result_Tokens {
    return new v1_3_0_Result_Tokens (
        convert__tokens_result__from__1_2_0(from.result)
    )
}