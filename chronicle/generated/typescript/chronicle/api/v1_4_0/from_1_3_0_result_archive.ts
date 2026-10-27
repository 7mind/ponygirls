import {Result_Archive as Archive__1_3_0} from '../v1_3_0/Result.js'
import {Result_Archive as v1_4_0_Result_Archive} from './Result.js'
import {convert__archive_result__from__1_3_0} from './from_1_3_0_archive-result.js'

export function convert__result__archive__from__1_3_0(from: Archive__1_3_0): v1_4_0_Result_Archive {
    return new v1_4_0_Result_Archive (
        convert__archive_result__from__1_3_0(from.result)
    )
}