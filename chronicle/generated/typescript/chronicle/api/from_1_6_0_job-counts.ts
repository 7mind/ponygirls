import {JobCounts as api_JobCounts} from './JobCounts.js'
import {JobCounts as JobCounts__1_6_0} from './v1_6_0/JobCounts.js'

export function convert__job_counts__from__1_6_0(from: JobCounts__1_6_0): api_JobCounts {
    return new api_JobCounts (
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