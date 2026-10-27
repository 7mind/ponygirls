import {Result_Facets as Facets__1_3_0} from '../v1_3_0/Result.js'
import {Result_Facets as v1_4_0_Result_Facets} from './Result.js'
import {convert__facets_result__from__1_3_0} from './from_1_3_0_facets-result.js'

export function convert__result__facets__from__1_3_0(from: Facets__1_3_0): v1_4_0_Result_Facets {
    return new v1_4_0_Result_Facets (
        convert__facets_result__from__1_3_0(from.result)
    )
}