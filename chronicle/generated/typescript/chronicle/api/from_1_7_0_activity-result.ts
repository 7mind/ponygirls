import {ActivityResult as api_ActivityResult} from './ActivityResult.js'
import {convert__activity_collector__from__1_7_0} from './from_1_7_0_activity-collector.js'
import {convert__job_counts__from__1_7_0} from './from_1_7_0_job-counts.js'
import {convert__user_info__from__1_7_0} from './from_1_7_0_user-info.js'
import {ActivityResult as ActivityResult__1_7_0} from './v1_7_0/ActivityResult.js'

export function convert__activity_result__from__1_7_0(from: ActivityResult__1_7_0): api_ActivityResult {
    return new api_ActivityResult (
        from.observedAt,
        convert__user_info__from__1_7_0(from.user),
        from.archiveHeads,
        from.headsWithoutTargetJob,
        convert__job_counts__from__1_7_0(from.current),
        convert__job_counts__from__1_7_0(from.historical),
        Array.from(from.collectors, item => convert__activity_collector__from__1_7_0(item)),
        from.totalCollectors,
        from.allCollectors,
        from.nextCursor
    )
}