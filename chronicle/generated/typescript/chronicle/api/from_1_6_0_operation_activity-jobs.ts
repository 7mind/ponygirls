import {Operation_ActivityJobs as api_Operation_ActivityJobs} from './Operation.js'
import {convert__activity_jobs_query__from__1_6_0} from './from_1_6_0_activity-jobs-query.js'
import {Operation_ActivityJobs as ActivityJobs__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__activity_jobs__from__1_6_0(from: ActivityJobs__1_6_0): api_Operation_ActivityJobs {
    return new api_Operation_ActivityJobs (
        convert__activity_jobs_query__from__1_6_0(from.query)
    )
}