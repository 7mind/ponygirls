import {FacetsResult as api_FacetsResult} from './FacetsResult.js'
import {convert__facet__from__1_0_0} from './from_1_0_0_facet.js'
import {FacetsResult as FacetsResult__1_0_0} from './v1_0_0/FacetsResult.js'

export function convert__facets_result__from__1_0_0(from: FacetsResult__1_0_0): api_FacetsResult {
    return new api_FacetsResult (
        Array.from(from.projects, item => convert__facet__from__1_0_0(item)),
        Array.from(from.branches, item => convert__facet__from__1_0_0(item)),
        Array.from(from.tags, item => convert__facet__from__1_0_0(item))
    )
}