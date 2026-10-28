import {ActivityJob as ActivityJob__1_4_0} from '../v1_4_0/ActivityJob.js'
import {ActivityJob as v1_5_0_ActivityJob} from './ActivityJob.js'
import {convert__activity_job_class__from__1_4_0} from './from_1_4_0_activity-job-class.js'
import {convert__job_info__from__1_4_0} from './from_1_4_0_job-info.js'
import {convert__session_info__from__1_4_0} from './from_1_4_0_session-info.js'

export function convert__activity_job__from__1_4_0(from: ActivityJob__1_4_0): v1_5_0_ActivityJob {
    return new v1_5_0_ActivityJob (
        convert__job_info__from__1_4_0(from.job),
        from.profile,
        convert__activity_job_class__from__1_4_0(from.classification),
        from.leaseExpiresAt,
        from.leaseActive,
        from.retryable,
        from.collectorId,
        convert__session_info__from__1_4_0(from.session),
        from.lastTimestamp
    )
}