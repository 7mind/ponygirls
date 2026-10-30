import {SessionMessageSearchResult as SessionMessageSearchResult__1_6_0} from '../v1_6_0/SessionMessageSearchResult.js'
import {SessionMessageSearchResult as v1_7_0_SessionMessageSearchResult} from './SessionMessageSearchResult.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'
import {convert__message_search_hit__from__1_6_0} from './from_1_6_0_message-search-hit.js'

export function convert__session_message_search_result__from__1_6_0(from: SessionMessageSearchResult__1_6_0): v1_7_0_SessionMessageSearchResult {
    return new v1_7_0_SessionMessageSearchResult (
        convert__content_view__from__1_6_0(from.view),
        Array.from(from.hits, item => convert__message_search_hit__from__1_6_0(item)),
        from.nextCursor
    )
}