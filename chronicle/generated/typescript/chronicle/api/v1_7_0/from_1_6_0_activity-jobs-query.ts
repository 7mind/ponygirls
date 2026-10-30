import {ActivityJobsQuery as ActivityJobsQuery__1_6_0} from '../v1_6_0/ActivityJobsQuery.js'
import {ActivityJobsQuery as v1_7_0_ActivityJobsQuery} from './ActivityJobsQuery.js'
import {convert__activity_job_scope__from__1_6_0} from './from_1_6_0_activity-job-scope.js'
import {convert__activity_job_sort__from__1_6_0} from './from_1_6_0_activity-job-sort.js'
import {convert__sort_direction__from__1_6_0} from './from_1_6_0_sort-direction.js'

export function convert__activity_jobs_query__from__1_6_0(from: ActivityJobsQuery__1_6_0): v1_7_0_ActivityJobsQuery {
    return new v1_7_0_ActivityJobsQuery (
        from.collectorId,
        convert__activity_job_scope__from__1_6_0(from.scope),
        from.expression,
        convert__activity_job_sort__from__1_6_0(from.sort),
        convert__sort_direction__from__1_6_0(from.direction),
        from.cursor,
        from.limit
    )
}