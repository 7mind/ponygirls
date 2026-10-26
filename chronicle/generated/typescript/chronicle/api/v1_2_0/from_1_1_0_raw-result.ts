import {RawResult as RawResult__1_1_0} from '../v1_1_0/RawResult.js'
import {RawResult as v1_2_0_RawResult} from './RawResult.js'
import {convert__raw_file__from__1_1_0} from './from_1_1_0_raw-file.js'

export function convert__raw_result__from__1_1_0(from: RawResult__1_1_0): v1_2_0_RawResult {
    return new v1_2_0_RawResult (
        Array.from(from.files, item => convert__raw_file__from__1_1_0(item)),
        from.revision
    )
}