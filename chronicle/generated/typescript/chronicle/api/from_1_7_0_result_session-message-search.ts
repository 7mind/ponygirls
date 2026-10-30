import {Result_SessionMessageSearch as api_Result_SessionMessageSearch} from './Result.js'
import {convert__session_message_search_result__from__1_7_0} from './from_1_7_0_session-message-search-result.js'
import {Result_SessionMessageSearch as SessionMessageSearch__1_7_0} from './v1_7_0/Result.js'

export function convert__result__session_message_search__from__1_7_0(from: SessionMessageSearch__1_7_0): api_Result_SessionMessageSearch {
    return new api_Result_SessionMessageSearch (
        convert__session_message_search_result__from__1_7_0(from.result)
    )
}