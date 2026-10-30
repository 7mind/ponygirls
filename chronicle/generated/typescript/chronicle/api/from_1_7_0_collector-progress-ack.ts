import {CollectorProgressAck as api_CollectorProgressAck} from './CollectorProgressAck.js'
import {CollectorProgressAck as CollectorProgressAck__1_7_0} from './v1_7_0/CollectorProgressAck.js'

export function convert__collector_progress_ack__from__1_7_0(from: CollectorProgressAck__1_7_0): api_CollectorProgressAck {
    return new api_CollectorProgressAck (
        from.sequence,
        from.accepted
    )
}