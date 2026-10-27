import {RetryFailedPlan as api_RetryFailedPlan} from './RetryFailedPlan.js'
import {convert__retry_failed_counts__from__1_4_0} from './from_1_4_0_retry-failed-counts.js'
import {RetryFailedPlan as RetryFailedPlan__1_4_0} from './v1_4_0/RetryFailedPlan.js'

export function convert__retry_failed_plan__from__1_4_0(from: RetryFailedPlan__1_4_0): api_RetryFailedPlan {
    return new api_RetryFailedPlan (
        from.targetProfile,
        from.selectionHash,
        convert__retry_failed_counts__from__1_4_0(from.counts)
    )
}