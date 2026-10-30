import {ActivityJob as ActivityJob__1_6_0} from '../v1_6_0/ActivityJob.js'
import {ActivityJob as v1_7_0_ActivityJob} from './ActivityJob.js'
import {convert__activity_job_class__from__1_6_0} from './from_1_6_0_activity-job-class.js'
import {convert__job_info__from__1_6_0} from './from_1_6_0_job-info.js'
import {convert__session_info__from__1_6_0} from './from_1_6_0_session-info.js'

export function convert__activity_job__from__1_6_0(from: ActivityJob__1_6_0): v1_7_0_ActivityJob {
    return new v1_7_0_ActivityJob (
        convert__job_info__from__1_6_0(from.job),
        from.profile,
        convert__activity_job_class__from__1_6_0(from.classification),
        from.leaseExpiresAt,
        from.leaseActive,
        from.retryable,
        from.collectorId,
        convert__session_info__from__1_6_0(from.session),
        from.lastTimestamp
    )
}