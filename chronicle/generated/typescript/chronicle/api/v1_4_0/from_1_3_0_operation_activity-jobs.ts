import {Operation_ActivityJobs as ActivityJobs__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_ActivityJobs as v1_4_0_Operation_ActivityJobs} from './Operation.js'
import {convert__activity_jobs_query__from__1_3_0} from './from_1_3_0_activity-jobs-query.js'

export function convert__operation__activity_jobs__from__1_3_0(from: ActivityJobs__1_3_0): v1_4_0_Operation_ActivityJobs {
    return new v1_4_0_Operation_ActivityJobs (
        convert__activity_jobs_query__from__1_3_0(from.query)
    )
}