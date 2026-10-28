import {CollectorProgressUpdate as CollectorProgressUpdate__1_4_0} from '../v1_4_0/CollectorProgressUpdate.js'
import {CollectorProgressUpdate as v1_5_0_CollectorProgressUpdate} from './CollectorProgressUpdate.js'
import {convert__collector_counters__from__1_4_0} from './from_1_4_0_collector-counters.js'
import {convert__collector_phase__from__1_4_0} from './from_1_4_0_collector-phase.js'

export function convert__collector_progress_update__from__1_4_0(from: CollectorProgressUpdate__1_4_0): v1_5_0_CollectorProgressUpdate {
    return new v1_5_0_CollectorProgressUpdate (
        from.collectorId,
        from.sequence,
        from.runId,
        convert__collector_phase__from__1_4_0(from.phase),
        from.startedAt,
        convert__collector_counters__from__1_4_0(from.counters),
        from.totalUploadBytes,
        from.uploadedBytes,
        from.currentUploadTotalBytes,
        from.error
    )
}