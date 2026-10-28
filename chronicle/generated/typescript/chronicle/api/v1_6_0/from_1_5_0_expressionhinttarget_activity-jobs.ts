import {ExpressionHintTarget_ActivityJobs as ActivityJobs__1_5_0} from '../v1_5_0/ExpressionHintTarget.js'
import {ExpressionHintTarget_ActivityJobs as v1_6_0_ExpressionHintTarget_ActivityJobs} from './ExpressionHintTarget.js'
import {convert__activity_job_scope__from__1_5_0} from './from_1_5_0_activity-job-scope.js'

export function convert__expression_hint_target__activity_jobs__from__1_5_0(from: ActivityJobs__1_5_0): v1_6_0_ExpressionHintTarget_ActivityJobs {
    return new v1_6_0_ExpressionHintTarget_ActivityJobs (
        convert__activity_job_scope__from__1_5_0(from.scope),
        from.collectorId
    )
}