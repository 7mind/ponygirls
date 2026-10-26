import {CollectorCounters as CollectorCounters__1_2_0} from '../v1_2_0/CollectorCounters.js'
import {CollectorCounters as v1_3_0_CollectorCounters} from './CollectorCounters.js'

export function convert__collector_counters__from__1_2_0(from: CollectorCounters__1_2_0): v1_3_0_CollectorCounters {
    return new v1_3_0_CollectorCounters (
        from.discovered,
        from.scanned,
        from.waiting,
        from.excluded,
        from.unchanged,
        from.enqueued,
        from.uploaded,
        from.uploadFailures,
        from.quarantined,
        from.pending,
        from.stopped,
        from.conflicts,
        from.scannedBytes
    )
}