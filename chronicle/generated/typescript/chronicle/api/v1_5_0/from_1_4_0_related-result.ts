import {RelatedResult as RelatedResult__1_4_0} from '../v1_4_0/RelatedResult.js'
import {RelatedResult as v1_5_0_RelatedResult} from './RelatedResult.js'
import {convert__search_hit__from__1_4_0} from './from_1_4_0_search-hit.js'

export function convert__related_result__from__1_4_0(from: RelatedResult__1_4_0): v1_5_0_RelatedResult {
    return new v1_5_0_RelatedResult (
        Array.from(from.sessions, item => convert__search_hit__from__1_4_0(item))
    )
}