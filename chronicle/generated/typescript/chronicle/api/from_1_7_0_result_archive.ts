import { convert__archive_result__from__1_7_0 } from '../../../../protocol/typescript/conversions.js';
import {Result_Archive as api_Result_Archive} from './Result.js'
import {Result_Archive as Archive__1_7_0} from './v1_7_0/Result.js'

export function convert__result__archive__from__1_7_0(from: Archive__1_7_0): api_Result_Archive {
    return new api_Result_Archive (
        convert__archive_result__from__1_7_0(from.result)
    )
}