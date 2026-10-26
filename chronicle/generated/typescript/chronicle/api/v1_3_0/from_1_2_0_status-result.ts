import {StatusResult as StatusResult__1_2_0} from '../v1_2_0/StatusResult.js'
import {StatusResult as v1_3_0_StatusResult} from './StatusResult.js'
import {convert__job_info__from__1_2_0} from './from_1_2_0_job-info.js'

export function convert__status_result__from__1_2_0(from: StatusResult__1_2_0): v1_3_0_StatusResult {
    return new v1_3_0_StatusResult (
        Array.from(from.jobs, item => convert__job_info__from__1_2_0(item)),
        from.total
    )
}