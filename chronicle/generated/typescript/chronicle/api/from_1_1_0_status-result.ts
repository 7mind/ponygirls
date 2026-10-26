import { convert__job_info__from__1_1_0 } from '../../../../protocol/typescript/conversions.js';
import {StatusResult as api_StatusResult} from './StatusResult.js'
import {StatusResult as StatusResult__1_1_0} from './v1_1_0/StatusResult.js'

export function convert__status_result__from__1_1_0(from: StatusResult__1_1_0): api_StatusResult {
    return new api_StatusResult (
        Array.from(from.jobs, item => convert__job_info__from__1_1_0(item)),
        from.total
    )
}