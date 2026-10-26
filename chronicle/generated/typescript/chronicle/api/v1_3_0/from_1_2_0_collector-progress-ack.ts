import {CollectorProgressAck as CollectorProgressAck__1_2_0} from '../v1_2_0/CollectorProgressAck.js'
import {CollectorProgressAck as v1_3_0_CollectorProgressAck} from './CollectorProgressAck.js'

export function convert__collector_progress_ack__from__1_2_0(from: CollectorProgressAck__1_2_0): v1_3_0_CollectorProgressAck {
    return new v1_3_0_CollectorProgressAck (
        from.sequence,
        from.accepted
    )
}