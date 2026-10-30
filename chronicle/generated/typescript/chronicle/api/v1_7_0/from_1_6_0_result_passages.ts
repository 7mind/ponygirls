import {Result_Passages as Passages__1_6_0} from '../v1_6_0/Result.js'
import {Result_Passages as v1_7_0_Result_Passages} from './Result.js'
import {convert__passages_result__from__1_6_0} from './from_1_6_0_passages-result.js'

export function convert__result__passages__from__1_6_0(from: Passages__1_6_0): v1_7_0_Result_Passages {
    return new v1_7_0_Result_Passages (
        convert__passages_result__from__1_6_0(from.result)
    )
}