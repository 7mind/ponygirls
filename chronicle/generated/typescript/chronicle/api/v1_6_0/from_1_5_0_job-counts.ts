import {JobCounts as JobCounts__1_5_0} from '../v1_5_0/JobCounts.js'
import {JobCounts as v1_6_0_JobCounts} from './JobCounts.js'

export function convert__job_counts__from__1_5_0(from: JobCounts__1_5_0): v1_6_0_JobCounts {
    return new v1_6_0_JobCounts (
        from.total,
        from.queued,
        from.running,
        from.failed,
        from.complete,
        from.activeRunning,
        from.expiredRunning,
        from.unleasedRunning
    )
}