import {CollectorStatus as api_CollectorStatus} from './CollectorStatus.js'
import {convert__collector_progress_update__from__1_6_0} from './from_1_6_0_collector-progress-update.js'
import {CollectorStatus as CollectorStatus__1_6_0} from './v1_6_0/CollectorStatus.js'

export function convert__collector_status__from__1_6_0(from: CollectorStatus__1_6_0): api_CollectorStatus {
    return new api_CollectorStatus (
        convert__collector_progress_update__from__1_6_0(from.report),
        from.receivedAt,
        from.stale
    )
}