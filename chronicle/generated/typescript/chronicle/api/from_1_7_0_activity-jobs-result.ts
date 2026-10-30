import {ActivityJobsResult as api_ActivityJobsResult} from './ActivityJobsResult.js'
import {convert__activity_job__from__1_7_0} from './from_1_7_0_activity-job.js'
import {ActivityJobsResult as ActivityJobsResult__1_7_0} from './v1_7_0/ActivityJobsResult.js'

export function convert__activity_jobs_result__from__1_7_0(from: ActivityJobsResult__1_7_0): api_ActivityJobsResult {
    return new api_ActivityJobsResult (
        from.observedAt,
        Array.from(from.jobs, item => convert__activity_job__from__1_7_0(item)),
        from.total,
        from.nextCursor
    )
}