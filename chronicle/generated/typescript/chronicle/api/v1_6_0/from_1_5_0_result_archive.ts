import {Result_Archive as Archive__1_5_0} from '../v1_5_0/Result.js'
import {Result_Archive as v1_6_0_Result_Archive} from './Result.js'
import {convert__archive_result__from__1_5_0} from './from_1_5_0_archive-result.js'

export function convert__result__archive__from__1_5_0(from: Archive__1_5_0): v1_6_0_Result_Archive {
    return new v1_6_0_Result_Archive (
        convert__archive_result__from__1_5_0(from.result)
    )
}