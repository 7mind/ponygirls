import {OwnerReindexResult as OwnerReindexResult__1_4_0} from '../v1_4_0/OwnerReindexResult.js'
import {OwnerReindexResult as v1_5_0_OwnerReindexResult} from './OwnerReindexResult.js'

export function convert__owner_reindex_result__from__1_4_0(from: OwnerReindexResult__1_4_0): v1_5_0_OwnerReindexResult {
    return new v1_5_0_OwnerReindexResult (
        from.requestId,
        from.targetProfile,
        from.heads,
        from.queued,
        from.alreadyCurrent,
        from.invalidatedClaims
    )
}