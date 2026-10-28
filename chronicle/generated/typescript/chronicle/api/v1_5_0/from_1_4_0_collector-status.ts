import {CollectorStatus as CollectorStatus__1_4_0} from '../v1_4_0/CollectorStatus.js'
import {CollectorStatus as v1_5_0_CollectorStatus} from './CollectorStatus.js'
import {convert__collector_progress_update__from__1_4_0} from './from_1_4_0_collector-progress-update.js'

export function convert__collector_status__from__1_4_0(from: CollectorStatus__1_4_0): v1_5_0_CollectorStatus {
    return new v1_5_0_CollectorStatus (
        convert__collector_progress_update__from__1_4_0(from.report),
        from.receivedAt,
        from.stale
    )
}