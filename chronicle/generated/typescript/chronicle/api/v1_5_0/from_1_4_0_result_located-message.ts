import {Result_LocatedMessage as LocatedMessage__1_4_0} from '../v1_4_0/Result.js'
import {Result_LocatedMessage as v1_5_0_Result_LocatedMessage} from './Result.js'
import {convert__message_location__from__1_4_0} from './from_1_4_0_message-location.js'

export function convert__result__located_message__from__1_4_0(from: LocatedMessage__1_4_0): v1_5_0_Result_LocatedMessage {
    return new v1_5_0_Result_LocatedMessage (
        convert__message_location__from__1_4_0(from.result)
    )
}