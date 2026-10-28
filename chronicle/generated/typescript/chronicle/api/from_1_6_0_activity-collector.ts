import {ActivityCollector as api_ActivityCollector} from './ActivityCollector.js'
import {convert__collector_status__from__1_6_0} from './from_1_6_0_collector-status.js'
import {convert__job_counts__from__1_6_0} from './from_1_6_0_job-counts.js'
import {ActivityCollector as ActivityCollector__1_6_0} from './v1_6_0/ActivityCollector.js'

export function convert__activity_collector__from__1_6_0(from: ActivityCollector__1_6_0): api_ActivityCollector {
    return new api_ActivityCollector (
        from.collectorId,
        (from.status === undefined ? undefined : convert__collector_status__from__1_6_0(from.status)),
        from.archiveHeads,
        from.headsWithoutTargetJob,
        convert__job_counts__from__1_6_0(from.current),
        convert__job_counts__from__1_6_0(from.historical)
    )
}