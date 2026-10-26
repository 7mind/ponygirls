import {Result_Messages as Messages__1_1_0} from '../v1_1_0/Result.js'
import {Result_Messages as v1_2_0_Result_Messages} from './Result.js'
import {convert__messages_result__from__1_1_0} from './from_1_1_0_messages-result.js'

export function convert__result__messages__from__1_1_0(from: Messages__1_1_0): v1_2_0_Result_Messages {
    return new v1_2_0_Result_Messages (
        convert__messages_result__from__1_1_0(from.result)
    )
}