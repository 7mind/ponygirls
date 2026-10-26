import {ClientEnvelope as api_ClientEnvelope} from './ClientEnvelope.js'
import {convert__operation__from__1_3_0} from './from_1_3_0_operation.js'
import {ClientEnvelope as ClientEnvelope__1_3_0} from './v1_3_0/ClientEnvelope.js'

export function convert__client_envelope__from__1_3_0(from: ClientEnvelope__1_3_0): api_ClientEnvelope {
    return new api_ClientEnvelope (
        from.requestId,
        convert__operation__from__1_3_0(from.operation)
    )
}