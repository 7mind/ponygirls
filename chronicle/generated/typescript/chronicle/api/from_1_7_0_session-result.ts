import {SessionResult as api_SessionResult} from './SessionResult.js'
import {convert__chunk__from__1_7_0} from './from_1_7_0_chunk.js'
import {convert__session_info__from__1_7_0} from './from_1_7_0_session-info.js'
import {SessionResult as SessionResult__1_7_0} from './v1_7_0/SessionResult.js'

export function convert__session_result__from__1_7_0(from: SessionResult__1_7_0): api_SessionResult {
    return new api_SessionResult (
        convert__session_info__from__1_7_0(from.session),
        Array.from(from.chunks, item => convert__chunk__from__1_7_0(item))
    )
}