import {MessagesResult as MessagesResult__1_4_0} from '../v1_4_0/MessagesResult.js'
import {MessagesResult as v1_5_0_MessagesResult} from './MessagesResult.js'
import {convert__content_view__from__1_4_0} from './from_1_4_0_content-view.js'
import {convert__message__from__1_4_0} from './from_1_4_0_message.js'

export function convert__messages_result__from__1_4_0(from: MessagesResult__1_4_0): v1_5_0_MessagesResult {
    return new v1_5_0_MessagesResult (
        Array.from(from.messages, item => convert__message__from__1_4_0(item)),
        from.total,
        from.offset,
        convert__content_view__from__1_4_0(from.view)
    )
}