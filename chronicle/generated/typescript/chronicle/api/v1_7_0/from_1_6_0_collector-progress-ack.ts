import {CollectorProgressAck as CollectorProgressAck__1_6_0} from '../v1_6_0/CollectorProgressAck.js'
import {CollectorProgressAck as v1_7_0_CollectorProgressAck} from './CollectorProgressAck.js'

export function convert__collector_progress_ack__from__1_6_0(from: CollectorProgressAck__1_6_0): v1_7_0_CollectorProgressAck {
    return new v1_7_0_CollectorProgressAck (
        from.sequence,
        from.accepted
    )
}