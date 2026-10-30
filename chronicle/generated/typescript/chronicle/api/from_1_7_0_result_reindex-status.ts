import {Result_ReindexStatus as api_Result_ReindexStatus} from './Result.js'
import {convert__reindex_status_result__from__1_7_0} from './from_1_7_0_reindex-status-result.js'
import {Result_ReindexStatus as ReindexStatus__1_7_0} from './v1_7_0/Result.js'

export function convert__result__reindex_status__from__1_7_0(from: ReindexStatus__1_7_0): api_Result_ReindexStatus {
    return new api_Result_ReindexStatus (
        convert__reindex_status_result__from__1_7_0(from.result)
    )
}