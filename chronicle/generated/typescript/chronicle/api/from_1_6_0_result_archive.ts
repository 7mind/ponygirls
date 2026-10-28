import {Result_Archive as api_Result_Archive} from './Result.js'
import {convert__archive_result__from__1_6_0} from './from_1_6_0_archive-result.js'
import {Result_Archive as Archive__1_6_0} from './v1_6_0/Result.js'

export function convert__result__archive__from__1_6_0(from: Archive__1_6_0): api_Result_Archive {
    return new api_Result_Archive (
        convert__archive_result__from__1_6_0(from.result)
    )
}