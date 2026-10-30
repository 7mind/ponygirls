import {ReindexStatusResult as api_ReindexStatusResult} from './ReindexStatusResult.js'
import {ReindexStatusResult as ReindexStatusResult__1_7_0} from './v1_7_0/ReindexStatusResult.js'

export function convert__reindex_status_result__from__1_7_0(from: ReindexStatusResult__1_7_0): api_ReindexStatusResult {
    return new api_ReindexStatusResult (
        from.requestId,
        from.targetProfile,
        from.total,
        from.complete,
        from.superseded,
        from.failed,
        from.pending
    )
}