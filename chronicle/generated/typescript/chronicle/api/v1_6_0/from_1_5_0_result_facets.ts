import {Result_Facets as Facets__1_5_0} from '../v1_5_0/Result.js'
import {Result_Facets as v1_6_0_Result_Facets} from './Result.js'
import {convert__facets_result__from__1_5_0} from './from_1_5_0_facets-result.js'

export function convert__result__facets__from__1_5_0(from: Facets__1_5_0): v1_6_0_Result_Facets {
    return new v1_6_0_Result_Facets (
        convert__facets_result__from__1_5_0(from.result)
    )
}