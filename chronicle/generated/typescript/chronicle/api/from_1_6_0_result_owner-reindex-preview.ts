import {Result_OwnerReindexPreview as api_Result_OwnerReindexPreview} from './Result.js'
import {convert__owner_reindex_plan__from__1_6_0} from './from_1_6_0_owner-reindex-plan.js'
import {Result_OwnerReindexPreview as OwnerReindexPreview__1_6_0} from './v1_6_0/Result.js'

export function convert__result__owner_reindex_preview__from__1_6_0(from: OwnerReindexPreview__1_6_0): api_Result_OwnerReindexPreview {
    return new api_Result_OwnerReindexPreview (
        convert__owner_reindex_plan__from__1_6_0(from.result)
    )
}