import {SessionMessageSearchResult as api_SessionMessageSearchResult} from './SessionMessageSearchResult.js'
import {convert__content_view__from__1_7_0} from './from_1_7_0_content-view.js'
import {convert__message_search_hit__from__1_7_0} from './from_1_7_0_message-search-hit.js'
import {SessionMessageSearchResult as SessionMessageSearchResult__1_7_0} from './v1_7_0/SessionMessageSearchResult.js'

export function convert__session_message_search_result__from__1_7_0(from: SessionMessageSearchResult__1_7_0): api_SessionMessageSearchResult {
    return new api_SessionMessageSearchResult (
        convert__content_view__from__1_7_0(from.view),
        Array.from(from.hits, item => convert__message_search_hit__from__1_7_0(item)),
        from.nextCursor
    )
}