import {Operation_LocateMessage as api_Operation_LocateMessage} from './Operation.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'
import {Operation_LocateMessage as LocateMessage__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__locate_message__from__1_6_0(from: LocateMessage__1_6_0): api_Operation_LocateMessage {
    return new api_Operation_LocateMessage (
        from.sessionId,
        convert__content_view__from__1_6_0(from.view),
        from.messageId
    )
}