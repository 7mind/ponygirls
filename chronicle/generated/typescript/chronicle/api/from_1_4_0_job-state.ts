import {JobState as api_JobState} from './JobState.js'
import {JobState as JobState__1_4_0} from './v1_4_0/JobState.js'

export function convert__job_state__from__1_4_0(from: JobState__1_4_0): api_JobState {
    return from as unknown as api_JobState;
}