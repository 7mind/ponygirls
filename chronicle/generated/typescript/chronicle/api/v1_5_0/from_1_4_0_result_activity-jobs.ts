import {Result_ActivityJobs as ActivityJobs__1_4_0} from '../v1_4_0/Result.js'
import {Result_ActivityJobs as v1_5_0_Result_ActivityJobs} from './Result.js'
import {convert__activity_jobs_result__from__1_4_0} from './from_1_4_0_activity-jobs-result.js'

export function convert__result__activity_jobs__from__1_4_0(from: ActivityJobs__1_4_0): v1_5_0_Result_ActivityJobs {
    return new v1_5_0_Result_ActivityJobs (
        convert__activity_jobs_result__from__1_4_0(from.result)
    )
}