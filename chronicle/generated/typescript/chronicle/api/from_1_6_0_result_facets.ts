import {Result_Facets as api_Result_Facets} from './Result.js'
import {convert__facets_result__from__1_6_0} from './from_1_6_0_facets-result.js'
import {Result_Facets as Facets__1_6_0} from './v1_6_0/Result.js'

export function convert__result__facets__from__1_6_0(from: Facets__1_6_0): api_Result_Facets {
    return new api_Result_Facets (
        convert__facets_result__from__1_6_0(from.result)
    )
}