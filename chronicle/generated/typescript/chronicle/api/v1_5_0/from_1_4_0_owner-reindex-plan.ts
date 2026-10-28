import {OwnerReindexPlan as OwnerReindexPlan__1_4_0} from '../v1_4_0/OwnerReindexPlan.js'
import {OwnerReindexPlan as v1_5_0_OwnerReindexPlan} from './OwnerReindexPlan.js'

export function convert__owner_reindex_plan__from__1_4_0(from: OwnerReindexPlan__1_4_0): v1_5_0_OwnerReindexPlan {
    return new v1_5_0_OwnerReindexPlan (
        from.currentTargetProfile,
        from.targetProfile,
        from.selectionHash,
        from.heads,
        from.alreadyCurrent,
        from.replacements
    )
}