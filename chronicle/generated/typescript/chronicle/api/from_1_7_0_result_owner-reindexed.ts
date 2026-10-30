import {Result_OwnerReindexed as api_Result_OwnerReindexed} from './Result.js'
import {convert__owner_reindex_result__from__1_7_0} from './from_1_7_0_owner-reindex-result.js'
import {Result_OwnerReindexed as OwnerReindexed__1_7_0} from './v1_7_0/Result.js'

export function convert__result__owner_reindexed__from__1_7_0(from: OwnerReindexed__1_7_0): api_Result_OwnerReindexed {
    return new api_Result_OwnerReindexed (
        convert__owner_reindex_result__from__1_7_0(from.result)
    )
}