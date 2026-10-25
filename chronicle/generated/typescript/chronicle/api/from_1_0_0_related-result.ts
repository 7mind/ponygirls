import {RelatedResult as api_RelatedResult} from './RelatedResult.js'
import {convert__search_hit__from__1_0_0} from './from_1_0_0_search-hit.js'
import {RelatedResult as RelatedResult__1_0_0} from './v1_0_0/RelatedResult.js'

export function convert__related_result__from__1_0_0(from: RelatedResult__1_0_0): api_RelatedResult {
    return new api_RelatedResult (
        Array.from(from.sessions, item => convert__search_hit__from__1_0_0(item))
    )
}