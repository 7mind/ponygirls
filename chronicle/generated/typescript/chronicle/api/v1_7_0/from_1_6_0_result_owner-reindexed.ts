import {Result_OwnerReindexed as OwnerReindexed__1_6_0} from '../v1_6_0/Result.js'
import {Result_OwnerReindexed as v1_7_0_Result_OwnerReindexed} from './Result.js'
import {convert__owner_reindex_result__from__1_6_0} from './from_1_6_0_owner-reindex-result.js'

export function convert__result__owner_reindexed__from__1_6_0(from: OwnerReindexed__1_6_0): v1_7_0_Result_OwnerReindexed {
    return new v1_7_0_Result_OwnerReindexed (
        convert__owner_reindex_result__from__1_6_0(from.result)
    )
}