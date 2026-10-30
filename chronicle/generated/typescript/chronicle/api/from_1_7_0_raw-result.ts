import {RawResult as api_RawResult} from './RawResult.js'
import {convert__raw_file__from__1_7_0} from './from_1_7_0_raw-file.js'
import {RawResult as RawResult__1_7_0} from './v1_7_0/RawResult.js'

export function convert__raw_result__from__1_7_0(from: RawResult__1_7_0): api_RawResult {
    return new api_RawResult (
        Array.from(from.files, item => convert__raw_file__from__1_7_0(item)),
        from.revision
    )
}