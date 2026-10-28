import {CollectorProgressAck as CollectorProgressAck__1_5_0} from '../v1_5_0/CollectorProgressAck.js'
import {CollectorProgressAck as v1_6_0_CollectorProgressAck} from './CollectorProgressAck.js'

export function convert__collector_progress_ack__from__1_5_0(from: CollectorProgressAck__1_5_0): v1_6_0_CollectorProgressAck {
    return new v1_6_0_CollectorProgressAck (
        from.sequence,
        from.accepted
    )
}