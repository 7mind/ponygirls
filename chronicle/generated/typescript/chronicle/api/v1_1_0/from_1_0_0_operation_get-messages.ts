import {Operation_GetMessages as GetMessages__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_GetMessages as v1_1_0_Operation_GetMessages} from './Operation.js'
import {convert__content_view__from__1_0_0} from './from_1_0_0_content-view.js'

export function convert__operation__get_messages__from__1_0_0(from: GetMessages__1_0_0): v1_1_0_Operation_GetMessages {
    return new v1_1_0_Operation_GetMessages (
        from.sessionId,
        from.offset,
        from.limit,
        (from.view === undefined ? undefined : convert__content_view__from__1_0_0(from.view))
    )
}