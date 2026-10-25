import {Result_Search as api_Result_Search} from './Result.js'
import {Result_Search as Search__1_0_0} from './v1_0_0/Result.js'

export function convert__result__search__from__1_0_0(from: Search__1_0_0): api_Result_Search {
    return new api_Result_Search (
        (() => { throw new Error("Custom conversion required: SearchResult -> SearchResult"); })()
    )
}