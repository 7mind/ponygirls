import {Result_Session as Session__1_4_0} from '../v1_4_0/Result.js'
import {Result_Session as v1_5_0_Result_Session} from './Result.js'
import {convert__session_result__from__1_4_0} from './from_1_4_0_session-result.js'

export function convert__result__session__from__1_4_0(from: Session__1_4_0): v1_5_0_Result_Session {
    return new v1_5_0_Result_Session (
        convert__session_result__from__1_4_0(from.result)
    )
}