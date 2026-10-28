import {Result_ActivityJobs as ActivityJobs__1_5_0} from '../v1_5_0/Result.js'
import {Result_ActivityJobs as v1_6_0_Result_ActivityJobs} from './Result.js'
import {convert__activity_jobs_result__from__1_5_0} from './from_1_5_0_activity-jobs-result.js'

export function convert__result__activity_jobs__from__1_5_0(from: ActivityJobs__1_5_0): v1_6_0_Result_ActivityJobs {
    return new v1_6_0_Result_ActivityJobs (
        convert__activity_jobs_result__from__1_5_0(from.result)
    )
}