import {Operation_GetRaw as GetRaw__1_2_0} from '../v1_2_0/Operation.js'
import {Operation_GetRaw as v1_3_0_Operation_GetRaw} from './Operation.js'

export function convert__operation__get_raw__from__1_2_0(from: GetRaw__1_2_0): v1_3_0_Operation_GetRaw {
    return new v1_3_0_Operation_GetRaw (
        from.sessionId,
        from.revision
    )
}