import {Result_LocatedMessage as api_Result_LocatedMessage} from './Result.js'
import {convert__message_location__from__1_3_0} from './from_1_3_0_message-location.js'
import {Result_LocatedMessage as LocatedMessage__1_3_0} from './v1_3_0/Result.js'

export function convert__result__located_message__from__1_3_0(from: LocatedMessage__1_3_0): api_Result_LocatedMessage {
    return new api_Result_LocatedMessage (
        convert__message_location__from__1_3_0(from.result)
    )
}