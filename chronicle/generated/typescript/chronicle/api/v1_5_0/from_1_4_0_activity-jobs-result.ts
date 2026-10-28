import {ActivityJobsResult as ActivityJobsResult__1_4_0} from '../v1_4_0/ActivityJobsResult.js'
import {ActivityJobsResult as v1_5_0_ActivityJobsResult} from './ActivityJobsResult.js'
import {convert__activity_job__from__1_4_0} from './from_1_4_0_activity-job.js'

export function convert__activity_jobs_result__from__1_4_0(from: ActivityJobsResult__1_4_0): v1_5_0_ActivityJobsResult {
    return new v1_5_0_ActivityJobsResult (
        from.observedAt,
        Array.from(from.jobs, item => convert__activity_job__from__1_4_0(item)),
        from.total,
        from.nextCursor
    )
}