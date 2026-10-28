import {Result_Passages as api_Result_Passages} from './Result.js'
import {convert__passages_result__from__1_6_0} from './from_1_6_0_passages-result.js'
import {Result_Passages as Passages__1_6_0} from './v1_6_0/Result.js'

export function convert__result__passages__from__1_6_0(from: Passages__1_6_0): api_Result_Passages {
    return new api_Result_Passages (
        convert__passages_result__from__1_6_0(from.result)
    )
}