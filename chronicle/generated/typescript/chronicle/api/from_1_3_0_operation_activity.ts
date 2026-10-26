import {Operation_Activity as api_Operation_Activity} from './Operation.js'
import {convert__activity_query__from__1_3_0} from './from_1_3_0_activity-query.js'
import {Operation_Activity as Activity__1_3_0} from './v1_3_0/Operation.js'

export function convert__operation__activity__from__1_3_0(from: Activity__1_3_0): api_Operation_Activity {
    return new api_Operation_Activity (
        convert__activity_query__from__1_3_0(from.query)
    )
}