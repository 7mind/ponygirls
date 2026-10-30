import {MessagesResult as api_MessagesResult} from './MessagesResult.js'
import {convert__content_view__from__1_7_0} from './from_1_7_0_content-view.js'
import {convert__message__from__1_7_0} from './from_1_7_0_message.js'
import {MessagesResult as MessagesResult__1_7_0} from './v1_7_0/MessagesResult.js'

export function convert__messages_result__from__1_7_0(from: MessagesResult__1_7_0): api_MessagesResult {
    return new api_MessagesResult (
        Array.from(from.messages, item => convert__message__from__1_7_0(item)),
        from.total,
        from.offset,
        convert__content_view__from__1_7_0(from.view)
    )
}