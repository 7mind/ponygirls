import {RetryFailedResult as RetryFailedResult__1_3_0} from '../v1_3_0/RetryFailedResult.js'
import {RetryFailedResult as v1_4_0_RetryFailedResult} from './RetryFailedResult.js'
import {convert__retry_failed_counts__from__1_3_0} from './from_1_3_0_retry-failed-counts.js'

export function convert__retry_failed_result__from__1_3_0(from: RetryFailedResult__1_3_0): v1_4_0_RetryFailedResult {
    return new v1_4_0_RetryFailedResult (
        from.requestId,
        from.targetProfile,
        from.retried,
        convert__retry_failed_counts__from__1_3_0(from.counts)
    )
}