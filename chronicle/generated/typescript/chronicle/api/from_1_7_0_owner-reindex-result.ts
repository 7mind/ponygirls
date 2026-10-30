import {OwnerReindexResult as api_OwnerReindexResult} from './OwnerReindexResult.js'
import {OwnerReindexResult as OwnerReindexResult__1_7_0} from './v1_7_0/OwnerReindexResult.js'

export function convert__owner_reindex_result__from__1_7_0(from: OwnerReindexResult__1_7_0): api_OwnerReindexResult {
    return new api_OwnerReindexResult (
        from.requestId,
        from.targetProfile,
        from.heads,
        from.queued,
        from.alreadyCurrent,
        from.invalidatedClaims
    )
}