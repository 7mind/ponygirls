import {StatusResult as api_StatusResult} from './StatusResult.js'
import {convert__job_info__from__1_3_0} from './from_1_3_0_job-info.js'
import {StatusResult as StatusResult__1_3_0} from './v1_3_0/StatusResult.js'

export function convert__status_result__from__1_3_0(from: StatusResult__1_3_0): api_StatusResult {
    return new api_StatusResult (
        Array.from(from.jobs, item => convert__job_info__from__1_3_0(item)),
        from.total
    )
}