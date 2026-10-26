import { convert__tokens_result__from__1_1_0 } from '../../../../../protocol/typescript/conversions.js';
import {Result_Tokens as Tokens__1_1_0} from '../v1_1_0/Result.js'
import {Result_Tokens as v1_2_0_Result_Tokens} from './Result.js'

export function convert__result__tokens__from__1_1_0(from: Tokens__1_1_0): v1_2_0_Result_Tokens {
    return new v1_2_0_Result_Tokens (
        convert__tokens_result__from__1_1_0(from.result)
    )
}