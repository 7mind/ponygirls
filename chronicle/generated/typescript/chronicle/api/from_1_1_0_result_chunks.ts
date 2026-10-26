import {Result_Chunks as api_Result_Chunks} from './Result.js'
import {convert__chunks_result__from__1_1_0} from './from_1_1_0_chunks-result.js'
import {Result_Chunks as Chunks__1_1_0} from './v1_1_0/Result.js'

export function convert__result__chunks__from__1_1_0(from: Chunks__1_1_0): api_Result_Chunks {
    return new api_Result_Chunks (
        convert__chunks_result__from__1_1_0(from.result)
    )
}