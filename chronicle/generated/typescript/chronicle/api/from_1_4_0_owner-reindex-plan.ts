import {OwnerReindexPlan as api_OwnerReindexPlan} from './OwnerReindexPlan.js'
import {OwnerReindexPlan as OwnerReindexPlan__1_4_0} from './v1_4_0/OwnerReindexPlan.js'

export function convert__owner_reindex_plan__from__1_4_0(from: OwnerReindexPlan__1_4_0): api_OwnerReindexPlan {
    return new api_OwnerReindexPlan (
        from.currentTargetProfile,
        from.targetProfile,
        from.selectionHash,
        from.heads,
        from.alreadyCurrent,
        from.replacements
    )
}