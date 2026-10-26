import {Result_Chunks as Chunks__1_0_0} from '../v1_0_0/Result.js'
import {Result_Chunks as v1_1_0_Result_Chunks} from './Result.js'
import {convert__chunks_result__from__1_0_0} from './from_1_0_0_chunks-result.js'

export function convert__result__chunks__from__1_0_0(from: Chunks__1_0_0): v1_1_0_Result_Chunks {
    return new v1_1_0_Result_Chunks (
        convert__chunks_result__from__1_0_0(from.result)
    )
}