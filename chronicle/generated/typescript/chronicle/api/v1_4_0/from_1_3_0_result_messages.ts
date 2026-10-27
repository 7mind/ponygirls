import {Result_Messages as Messages__1_3_0} from '../v1_3_0/Result.js'
import {Result_Messages as v1_4_0_Result_Messages} from './Result.js'
import {convert__messages_result__from__1_3_0} from './from_1_3_0_messages-result.js'

export function convert__result__messages__from__1_3_0(from: Messages__1_3_0): v1_4_0_Result_Messages {
    return new v1_4_0_Result_Messages (
        convert__messages_result__from__1_3_0(from.result)
    )
}