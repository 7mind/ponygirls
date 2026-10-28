import {OwnerReindexPlan as OwnerReindexPlan__1_5_0} from '../v1_5_0/OwnerReindexPlan.js'
import {OwnerReindexPlan as v1_6_0_OwnerReindexPlan} from './OwnerReindexPlan.js'

export function convert__owner_reindex_plan__from__1_5_0(from: OwnerReindexPlan__1_5_0): v1_6_0_OwnerReindexPlan {
    return new v1_6_0_OwnerReindexPlan (
        from.currentTargetProfile,
        from.targetProfile,
        from.selectionHash,
        from.heads,
        from.alreadyCurrent,
        from.replacements
    )
}