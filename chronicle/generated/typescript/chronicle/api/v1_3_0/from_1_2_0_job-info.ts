import {JobInfo as JobInfo__1_2_0} from '../v1_2_0/JobInfo.js'
import {JobInfo as v1_3_0_JobInfo} from './JobInfo.js'
import {convert__job_state__from__1_2_0} from './from_1_2_0_job-state.js'

export function convert__job_info__from__1_2_0(from: JobInfo__1_2_0): v1_3_0_JobInfo {
    return new v1_3_0_JobInfo (
        from.id,
        from.sessionId,
        from.revision,
        convert__job_state__from__1_2_0(from.state),
        from.attempts,
        from.error,
        from.completedWindows,
        from.totalWindows
    )
}