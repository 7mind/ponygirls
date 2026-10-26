import {ActivityJobsQuery as api_ActivityJobsQuery} from './ActivityJobsQuery.js'
import {convert__activity_job_scope__from__1_3_0} from './from_1_3_0_activity-job-scope.js'
import {convert__activity_job_sort__from__1_3_0} from './from_1_3_0_activity-job-sort.js'
import {convert__sort_direction__from__1_3_0} from './from_1_3_0_sort-direction.js'
import {ActivityJobsQuery as ActivityJobsQuery__1_3_0} from './v1_3_0/ActivityJobsQuery.js'

export function convert__activity_jobs_query__from__1_3_0(from: ActivityJobsQuery__1_3_0): api_ActivityJobsQuery {
    return new api_ActivityJobsQuery (
        from.collectorId,
        convert__activity_job_scope__from__1_3_0(from.scope),
        from.expression,
        convert__activity_job_sort__from__1_3_0(from.sort),
        convert__sort_direction__from__1_3_0(from.direction),
        from.cursor,
        from.limit
    )
}