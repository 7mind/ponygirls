import {Result_Messages as api_Result_Messages} from './Result.js'
import {convert__messages_result__from__1_3_0} from './from_1_3_0_messages-result.js'
import {Result_Messages as Messages__1_3_0} from './v1_3_0/Result.js'

export function convert__result__messages__from__1_3_0(from: Messages__1_3_0): api_Result_Messages {
    return new api_Result_Messages (
        convert__messages_result__from__1_3_0(from.result)
    )
}