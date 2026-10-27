import {Operation_Activity as Activity__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_Activity as v1_4_0_Operation_Activity} from './Operation.js'
import {convert__activity_query__from__1_3_0} from './from_1_3_0_activity-query.js'

export function convert__operation__activity__from__1_3_0(from: Activity__1_3_0): v1_4_0_Operation_Activity {
    return new v1_4_0_Operation_Activity (
        convert__activity_query__from__1_3_0(from.query)
    )
}