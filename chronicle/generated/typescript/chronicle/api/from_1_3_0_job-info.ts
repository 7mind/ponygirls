import {JobInfo as api_JobInfo} from './JobInfo.js'
import {convert__job_state__from__1_3_0} from './from_1_3_0_job-state.js'
import {JobInfo as JobInfo__1_3_0} from './v1_3_0/JobInfo.js'

export function convert__job_info__from__1_3_0(from: JobInfo__1_3_0): api_JobInfo {
    return new api_JobInfo (
        from.id,
        from.sessionId,
        from.revision,
        convert__job_state__from__1_3_0(from.state),
        from.attempts,
        from.error,
        from.completedWindows,
        from.totalWindows
    )
}