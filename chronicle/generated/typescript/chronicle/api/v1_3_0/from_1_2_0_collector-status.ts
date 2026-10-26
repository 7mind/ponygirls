import {CollectorStatus as CollectorStatus__1_2_0} from '../v1_2_0/CollectorStatus.js'
import {CollectorStatus as v1_3_0_CollectorStatus} from './CollectorStatus.js'
import {convert__collector_progress_update__from__1_2_0} from './from_1_2_0_collector-progress-update.js'

export function convert__collector_status__from__1_2_0(from: CollectorStatus__1_2_0): v1_3_0_CollectorStatus {
    return new v1_3_0_CollectorStatus (
        convert__collector_progress_update__from__1_2_0(from.report),
        from.receivedAt,
        from.stale
    )
}