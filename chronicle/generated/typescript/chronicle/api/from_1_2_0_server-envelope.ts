import {ServerEnvelope as api_ServerEnvelope} from './ServerEnvelope.js'
import {convert__result__from__1_2_0} from './from_1_2_0_result.js'
import {ServerEnvelope as ServerEnvelope__1_2_0} from './v1_2_0/ServerEnvelope.js'

export function convert__server_envelope__from__1_2_0(from: ServerEnvelope__1_2_0): api_ServerEnvelope {
    return new api_ServerEnvelope (
        from.requestId,
        convert__result__from__1_2_0(from.result)
    )
}