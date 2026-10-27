import {ActivityJob as api_ActivityJob} from './ActivityJob.js'
import {convert__activity_job_class__from__1_4_0} from './from_1_4_0_activity-job-class.js'
import {convert__job_info__from__1_4_0} from './from_1_4_0_job-info.js'
import {convert__session_info__from__1_4_0} from './from_1_4_0_session-info.js'
import {ActivityJob as ActivityJob__1_4_0} from './v1_4_0/ActivityJob.js'

export function convert__activity_job__from__1_4_0(from: ActivityJob__1_4_0): api_ActivityJob {
    return new api_ActivityJob (
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