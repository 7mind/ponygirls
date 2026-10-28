import {Operation_ActivityJobs as ActivityJobs__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_ActivityJobs as v1_6_0_Operation_ActivityJobs} from './Operation.js'
import {convert__activity_jobs_query__from__1_5_0} from './from_1_5_0_activity-jobs-query.js'

export function convert__operation__activity_jobs__from__1_5_0(from: ActivityJobs__1_5_0): v1_6_0_Operation_ActivityJobs {
    return new v1_6_0_Operation_ActivityJobs (
        convert__activity_jobs_query__from__1_5_0(from.query)
    )
}