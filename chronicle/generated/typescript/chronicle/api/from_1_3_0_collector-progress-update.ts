import {CollectorProgressUpdate as api_CollectorProgressUpdate} from './CollectorProgressUpdate.js'
import {convert__collector_counters__from__1_3_0} from './from_1_3_0_collector-counters.js'
import {convert__collector_phase__from__1_3_0} from './from_1_3_0_collector-phase.js'
import {CollectorProgressUpdate as CollectorProgressUpdate__1_3_0} from './v1_3_0/CollectorProgressUpdate.js'

export function convert__collector_progress_update__from__1_3_0(from: CollectorProgressUpdate__1_3_0): api_CollectorProgressUpdate {
    return new api_CollectorProgressUpdate (
        from.collectorId,
        from.sequence,
        from.runId,
        convert__collector_phase__from__1_3_0(from.phase),
        from.startedAt,
        convert__collector_counters__from__1_3_0(from.counters),
        from.totalUploadBytes,
        from.uploadedBytes,
        from.currentUploadTotalBytes,
        from.error
    )
}