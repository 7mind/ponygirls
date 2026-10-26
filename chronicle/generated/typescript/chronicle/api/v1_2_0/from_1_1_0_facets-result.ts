import {FacetsResult as FacetsResult__1_1_0} from '../v1_1_0/FacetsResult.js'
import {FacetsResult as v1_2_0_FacetsResult} from './FacetsResult.js'
import {convert__facet__from__1_1_0} from './from_1_1_0_facet.js'

export function convert__facets_result__from__1_1_0(from: FacetsResult__1_1_0): v1_2_0_FacetsResult {
    return new v1_2_0_FacetsResult (
        Array.from(from.projects, item => convert__facet__from__1_1_0(item)),
        Array.from(from.branches, item => convert__facet__from__1_1_0(item)),
        Array.from(from.tags, item => convert__facet__from__1_1_0(item))
    )
}