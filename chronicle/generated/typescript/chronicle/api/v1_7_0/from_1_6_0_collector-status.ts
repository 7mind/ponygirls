import {CollectorStatus as CollectorStatus__1_6_0} from '../v1_6_0/CollectorStatus.js'
import {CollectorStatus as v1_7_0_CollectorStatus} from './CollectorStatus.js'
import {convert__collector_progress_update__from__1_6_0} from './from_1_6_0_collector-progress-update.js'

export function convert__collector_status__from__1_6_0(from: CollectorStatus__1_6_0): v1_7_0_CollectorStatus {
    return new v1_7_0_CollectorStatus (
        convert__collector_progress_update__from__1_6_0(from.report),
        from.receivedAt,
        from.stale
    )
}