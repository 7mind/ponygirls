import {ActivityResult as ActivityResult__1_5_0} from '../v1_5_0/ActivityResult.js'
import {ActivityResult as v1_6_0_ActivityResult} from './ActivityResult.js'
import {convert__activity_collector__from__1_5_0} from './from_1_5_0_activity-collector.js'
import {convert__job_counts__from__1_5_0} from './from_1_5_0_job-counts.js'
import {convert__user_info__from__1_5_0} from './from_1_5_0_user-info.js'

export function convert__activity_result__from__1_5_0(from: ActivityResult__1_5_0): v1_6_0_ActivityResult {
    return new v1_6_0_ActivityResult (
        from.observedAt,
        convert__user_info__from__1_5_0(from.user),
        from.archiveHeads,
        from.headsWithoutTargetJob,
        convert__job_counts__from__1_5_0(from.current),
        convert__job_counts__from__1_5_0(from.historical),
        Array.from(from.collectors, item => convert__activity_collector__from__1_5_0(item)),
        from.totalCollectors,
        from.allCollectors,
        from.nextCursor
    )
}