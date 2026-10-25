import {Operation_GetRaw as api_Operation_GetRaw} from './Operation.js'
import {Operation_GetRaw as GetRaw__1_0_0} from './v1_0_0/Operation.js'

export function convert__operation__get_raw__from__1_0_0(from: GetRaw__1_0_0): api_Operation_GetRaw {
    return new api_Operation_GetRaw (
        from.sessionId,
        from.revision
    )
}