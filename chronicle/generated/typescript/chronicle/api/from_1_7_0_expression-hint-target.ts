import {ExpressionHintTarget as api_ExpressionHintTarget} from './ExpressionHintTarget.js'
import {convert__expression_hint_target__activity_collectors__from__1_7_0} from './from_1_7_0_expressionhinttarget_activity-collectors.js'
import {convert__expression_hint_target__activity_jobs__from__1_7_0} from './from_1_7_0_expressionhinttarget_activity-jobs.js'
import {convert__expression_hint_target__archive__from__1_7_0} from './from_1_7_0_expressionhinttarget_archive.js'
import {ExpressionHintTarget as ExpressionHintTarget__1_7_0, ExpressionHintTarget_ActivityCollectors as ActivityCollectors__1_7_0, ExpressionHintTarget_ActivityJobs as ActivityJobs__1_7_0, ExpressionHintTarget_Archive as Archive__1_7_0} from './v1_7_0/ExpressionHintTarget.js'

export function convert__expression_hint_target__from__1_7_0(from: ExpressionHintTarget__1_7_0): api_ExpressionHintTarget {
    if (from instanceof Archive__1_7_0) {
        return convert__expression_hint_target__archive__from__1_7_0(from)
    }
    if (from instanceof ActivityCollectors__1_7_0) {
        return convert__expression_hint_target__activity_collectors__from__1_7_0(from)
    }
    if (from instanceof ActivityJobs__1_7_0) {
        return convert__expression_hint_target__activity_jobs__from__1_7_0(from)
    }

    throw new Error("Unknown ADT branch: " + from);
}