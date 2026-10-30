import {Operation_SearchSessionMessages as SearchSessionMessages__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_SearchSessionMessages as v1_7_0_Operation_SearchSessionMessages} from './Operation.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'

export function convert__operation__search_session_messages__from__1_6_0(from: SearchSessionMessages__1_6_0): v1_7_0_Operation_SearchSessionMessages {
    return new v1_7_0_Operation_SearchSessionMessages (
        from.sessionId,
        convert__content_view__from__1_6_0(from.view),
        from.literal,
        from.cursor,
        from.limit
    )
}