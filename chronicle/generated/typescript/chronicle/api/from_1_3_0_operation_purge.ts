import {Operation_Purge as api_Operation_Purge} from './Operation.js'
import {Operation_Purge as Purge__1_3_0} from './v1_3_0/Operation.js'

export function convert__operation__purge__from__1_3_0(from: Purge__1_3_0): api_Operation_Purge {
    return new api_Operation_Purge (
        from.sessionId
    )
}