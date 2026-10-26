import { convert__job_info__from__1_1_0 } from '../../../../../protocol/typescript/conversions.js';
import {StatusResult as StatusResult__1_1_0} from '../v1_1_0/StatusResult.js'
import {StatusResult as v1_2_0_StatusResult} from './StatusResult.js'

export function convert__status_result__from__1_1_0(from: StatusResult__1_1_0): v1_2_0_StatusResult {
    return new v1_2_0_StatusResult (
        Array.from(from.jobs, item => convert__job_info__from__1_1_0(item)),
        from.total
    )
}