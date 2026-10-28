import {Operation_Activity as Activity__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_Activity as v1_5_0_Operation_Activity} from './Operation.js'
import {convert__activity_query__from__1_4_0} from './from_1_4_0_activity-query.js'

export function convert__operation__activity__from__1_4_0(from: Activity__1_4_0): v1_5_0_Operation_Activity {
    return new v1_5_0_Operation_Activity (
        convert__activity_query__from__1_4_0(from.query)
    )
}