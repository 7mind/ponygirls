import {RetryFailedCounts as RetryFailedCounts__1_6_0} from '../v1_6_0/RetryFailedCounts.js'
import {RetryFailedCounts as v1_7_0_RetryFailedCounts} from './RetryFailedCounts.js'

export function convert__retry_failed_counts__from__1_6_0(from: RetryFailedCounts__1_6_0): v1_7_0_RetryFailedCounts {
    return new v1_7_0_RetryFailedCounts (
        from.eligibleCurrentFailed,
        from.supersededRevisionFailed,
        from.obsoleteProfileFailed,
        from.supersededRevisionAndProfileFailed,
        from.unchangedQueued,
        from.unchangedRunning,
        from.unchangedComplete
    )
}