import {SessionResult as SessionResult__1_0_0} from '../v1_0_0/SessionResult.js'
import {SessionResult as v1_1_0_SessionResult} from './SessionResult.js'
import {convert__chunk__from__1_0_0} from './from_1_0_0_chunk.js'
import {convert__session_info__from__1_0_0} from './from_1_0_0_session-info.js'

export function convert__session_result__from__1_0_0(from: SessionResult__1_0_0): v1_1_0_SessionResult {
    return new v1_1_0_SessionResult (
        convert__session_info__from__1_0_0(from.session),
        Array.from(from.chunks, item => convert__chunk__from__1_0_0(item))
    )
}