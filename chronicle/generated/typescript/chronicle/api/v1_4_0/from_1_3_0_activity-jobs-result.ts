import {ActivityJobsResult as ActivityJobsResult__1_3_0} from '../v1_3_0/ActivityJobsResult.js'
import {ActivityJobsResult as v1_4_0_ActivityJobsResult} from './ActivityJobsResult.js'
import {convert__activity_job__from__1_3_0} from './from_1_3_0_activity-job.js'

export function convert__activity_jobs_result__from__1_3_0(from: ActivityJobsResult__1_3_0): v1_4_0_ActivityJobsResult {
    return new v1_4_0_ActivityJobsResult (
        from.observedAt,
        Array.from(from.jobs, item => convert__activity_job__from__1_3_0(item)),
        from.total,
        from.nextCursor
    )
}