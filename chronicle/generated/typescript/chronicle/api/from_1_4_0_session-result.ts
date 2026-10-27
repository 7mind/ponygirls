import {SessionResult as api_SessionResult} from './SessionResult.js'
import {convert__chunk__from__1_4_0} from './from_1_4_0_chunk.js'
import {convert__session_info__from__1_4_0} from './from_1_4_0_session-info.js'
import {SessionResult as SessionResult__1_4_0} from './v1_4_0/SessionResult.js'

export function convert__session_result__from__1_4_0(from: SessionResult__1_4_0): api_SessionResult {
    return new api_SessionResult (
        convert__session_info__from__1_4_0(from.session),
        Array.from(from.chunks, item => convert__chunk__from__1_4_0(item))
    )
}