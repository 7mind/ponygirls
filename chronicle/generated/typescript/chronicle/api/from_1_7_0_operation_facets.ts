import {Operation_Facets as api_Operation_Facets} from './Operation.js'
import {convert__search_filter__from__1_7_0} from './from_1_7_0_search-filter.js'
import {Operation_Facets as Facets__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__facets__from__1_7_0(from: Facets__1_7_0): api_Operation_Facets {
    return new api_Operation_Facets (
        convert__search_filter__from__1_7_0(from.filter)
    )
}