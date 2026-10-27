import {StatusResult as StatusResult__1_3_0} from '../v1_3_0/StatusResult.js'
import {StatusResult as v1_4_0_StatusResult} from './StatusResult.js'
import {convert__job_info__from__1_3_0} from './from_1_3_0_job-info.js'

export function convert__status_result__from__1_3_0(from: StatusResult__1_3_0): v1_4_0_StatusResult {
    return new v1_4_0_StatusResult (
        Array.from(from.jobs, item => convert__job_info__from__1_3_0(item)),
        from.total
    )
}