import {ServerEnvelope as ServerEnvelope__1_6_0} from '../v1_6_0/ServerEnvelope.js'
import {ServerEnvelope as v1_7_0_ServerEnvelope} from './ServerEnvelope.js'
import {convert__result__from__1_6_0} from './from_1_6_0_result.js'

export function convert__server_envelope__from__1_6_0(from: ServerEnvelope__1_6_0): v1_7_0_ServerEnvelope {
    return new v1_7_0_ServerEnvelope (
        from.requestId,
        convert__result__from__1_6_0(from.result)
    )
}