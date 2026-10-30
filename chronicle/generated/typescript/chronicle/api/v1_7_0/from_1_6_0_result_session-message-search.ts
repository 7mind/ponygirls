import {Result_SessionMessageSearch as SessionMessageSearch__1_6_0} from '../v1_6_0/Result.js'
import {Result_SessionMessageSearch as v1_7_0_Result_SessionMessageSearch} from './Result.js'
import {convert__session_message_search_result__from__1_6_0} from './from_1_6_0_session-message-search-result.js'

export function convert__result__session_message_search__from__1_6_0(from: SessionMessageSearch__1_6_0): v1_7_0_Result_SessionMessageSearch {
    return new v1_7_0_Result_SessionMessageSearch (
        convert__session_message_search_result__from__1_6_0(from.result)
    )
}