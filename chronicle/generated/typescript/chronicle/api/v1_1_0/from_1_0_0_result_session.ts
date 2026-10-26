import {Result_Session as Session__1_0_0} from '../v1_0_0/Result.js'
import {Result_Session as v1_1_0_Result_Session} from './Result.js'
import {convert__session_result__from__1_0_0} from './from_1_0_0_session-result.js'

export function convert__result__session__from__1_0_0(from: Session__1_0_0): v1_1_0_Result_Session {
    return new v1_1_0_Result_Session (
        convert__session_result__from__1_0_0(from.result)
    )
}