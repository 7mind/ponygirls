import {Operation_GetRaw as GetRaw__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_GetRaw as v1_4_0_Operation_GetRaw} from './Operation.js'

export function convert__operation__get_raw__from__1_3_0(from: GetRaw__1_3_0): v1_4_0_Operation_GetRaw {
    return new v1_4_0_Operation_GetRaw (
        from.sessionId,
        from.revision
    )
}