import {ExpressionHintTarget_ActivityJobs as api_ExpressionHintTarget_ActivityJobs} from './ExpressionHintTarget.js'
import {convert__activity_job_scope__from__1_6_0} from './from_1_6_0_activity-job-scope.js'
import {ExpressionHintTarget_ActivityJobs as ActivityJobs__1_6_0} from './v1_6_0/ExpressionHintTarget.js'

export function convert__expression_hint_target__activity_jobs__from__1_6_0(from: ActivityJobs__1_6_0): api_ExpressionHintTarget_ActivityJobs {
    return new api_ExpressionHintTarget_ActivityJobs (
        convert__activity_job_scope__from__1_6_0(from.scope),
        from.collectorId
    )
}