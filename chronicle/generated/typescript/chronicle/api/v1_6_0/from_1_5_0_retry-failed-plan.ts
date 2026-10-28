import {RetryFailedPlan as RetryFailedPlan__1_5_0} from '../v1_5_0/RetryFailedPlan.js'
import {RetryFailedPlan as v1_6_0_RetryFailedPlan} from './RetryFailedPlan.js'
import {convert__retry_failed_counts__from__1_5_0} from './from_1_5_0_retry-failed-counts.js'

export function convert__retry_failed_plan__from__1_5_0(from: RetryFailedPlan__1_5_0): v1_6_0_RetryFailedPlan {
    return new v1_6_0_RetryFailedPlan (
        from.targetProfile,
        from.selectionHash,
        convert__retry_failed_counts__from__1_5_0(from.counts)
    )
}