import {Result_OwnerReindexPreview as OwnerReindexPreview__1_5_0} from '../v1_5_0/Result.js'
import {Result_OwnerReindexPreview as v1_6_0_Result_OwnerReindexPreview} from './Result.js'
import {convert__owner_reindex_plan__from__1_5_0} from './from_1_5_0_owner-reindex-plan.js'

export function convert__result__owner_reindex_preview__from__1_5_0(from: OwnerReindexPreview__1_5_0): v1_6_0_Result_OwnerReindexPreview {
    return new v1_6_0_Result_OwnerReindexPreview (
        convert__owner_reindex_plan__from__1_5_0(from.result)
    )
}