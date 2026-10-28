import {RetryFailedResult as api_RetryFailedResult} from './RetryFailedResult.js'
import {convert__retry_failed_counts__from__1_6_0} from './from_1_6_0_retry-failed-counts.js'
import {RetryFailedResult as RetryFailedResult__1_6_0} from './v1_6_0/RetryFailedResult.js'

export function convert__retry_failed_result__from__1_6_0(from: RetryFailedResult__1_6_0): api_RetryFailedResult {
    return new api_RetryFailedResult (
        from.requestId,
        from.targetProfile,
        from.retried,
        convert__retry_failed_counts__from__1_6_0(from.counts)
    )
}