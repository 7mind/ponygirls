import {ServerEnvelope as ServerEnvelope__1_1_0} from '../v1_1_0/ServerEnvelope.js'
import {ServerEnvelope as v1_2_0_ServerEnvelope} from './ServerEnvelope.js'
import {convert__result__from__1_1_0} from './from_1_1_0_result.js'

export function convert__server_envelope__from__1_1_0(from: ServerEnvelope__1_1_0): v1_2_0_ServerEnvelope {
    return new v1_2_0_ServerEnvelope (
        from.requestId,
        convert__result__from__1_1_0(from.result)
    )
}