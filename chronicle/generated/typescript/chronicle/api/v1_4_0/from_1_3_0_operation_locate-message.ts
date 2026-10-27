import {Operation_LocateMessage as LocateMessage__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_LocateMessage as v1_4_0_Operation_LocateMessage} from './Operation.js'
import {convert__content_view__from__1_3_0} from './from_1_3_0_content-view.js'

export function convert__operation__locate_message__from__1_3_0(from: LocateMessage__1_3_0): v1_4_0_Operation_LocateMessage {
    return new v1_4_0_Operation_LocateMessage (
        from.sessionId,
        convert__content_view__from__1_3_0(from.view),
        from.messageId
    )
}