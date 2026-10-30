import {Result_Session as Session__1_6_0} from '../v1_6_0/Result.js'
import {Result_Session as v1_7_0_Result_Session} from './Result.js'
import {convert__session_result__from__1_6_0} from './from_1_6_0_session-result.js'

export function convert__result__session__from__1_6_0(from: Session__1_6_0): v1_7_0_Result_Session {
    return new v1_7_0_Result_Session (
        convert__session_result__from__1_6_0(from.result)
    )
}