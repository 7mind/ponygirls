import {RetryFailedCounts as api_RetryFailedCounts} from './RetryFailedCounts.js'
import {RetryFailedCounts as RetryFailedCounts__1_4_0} from './v1_4_0/RetryFailedCounts.js'

export function convert__retry_failed_counts__from__1_4_0(from: RetryFailedCounts__1_4_0): api_RetryFailedCounts {
    return new api_RetryFailedCounts (
        from.eligibleCurrentFailed,
        from.supersededRevisionFailed,
        from.obsoleteProfileFailed,
        from.supersededRevisionAndProfileFailed,
        from.unchangedQueued,
        from.unchangedRunning,
        from.unchangedComplete
    )
}