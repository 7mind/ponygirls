import {RetryFailedResult as RetryFailedResult__1_4_0} from '../v1_4_0/RetryFailedResult.js'
import {RetryFailedResult as v1_5_0_RetryFailedResult} from './RetryFailedResult.js'
import {convert__retry_failed_counts__from__1_4_0} from './from_1_4_0_retry-failed-counts.js'

export function convert__retry_failed_result__from__1_4_0(from: RetryFailedResult__1_4_0): v1_5_0_RetryFailedResult {
    return new v1_5_0_RetryFailedResult (
        from.requestId,
        from.targetProfile,
        from.retried,
        convert__retry_failed_counts__from__1_4_0(from.counts)
    )
}