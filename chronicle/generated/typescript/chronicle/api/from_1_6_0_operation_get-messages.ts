import {Operation_GetMessages as api_Operation_GetMessages} from './Operation.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'
import {Operation_GetMessages as GetMessages__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__get_messages__from__1_6_0(from: GetMessages__1_6_0): api_Operation_GetMessages {
    return new api_Operation_GetMessages (
        from.sessionId,
        from.offset,
        from.limit,
        (from.view === undefined ? undefined : convert__content_view__from__1_6_0(from.view))
    )
}