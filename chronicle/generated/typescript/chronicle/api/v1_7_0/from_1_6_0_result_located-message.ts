import {Result_LocatedMessage as LocatedMessage__1_6_0} from '../v1_6_0/Result.js'
import {Result_LocatedMessage as v1_7_0_Result_LocatedMessage} from './Result.js'
import {convert__message_location__from__1_6_0} from './from_1_6_0_message-location.js'

export function convert__result__located_message__from__1_6_0(from: LocatedMessage__1_6_0): v1_7_0_Result_LocatedMessage {
    return new v1_7_0_Result_LocatedMessage (
        convert__message_location__from__1_6_0(from.result)
    )
}