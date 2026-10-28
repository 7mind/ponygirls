import {Operation_Facets as Facets__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_Facets as v1_5_0_Operation_Facets} from './Operation.js'
import {convert__search_filter__from__1_4_0} from './from_1_4_0_search-filter.js'

export function convert__operation__facets__from__1_4_0(from: Facets__1_4_0): v1_5_0_Operation_Facets {
    return new v1_5_0_Operation_Facets (
        convert__search_filter__from__1_4_0(from.filter)
    )
}