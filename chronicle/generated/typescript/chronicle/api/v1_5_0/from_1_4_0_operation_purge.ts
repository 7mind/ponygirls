import {Operation_Purge as Purge__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_Purge as v1_5_0_Operation_Purge} from './Operation.js'

export function convert__operation__purge__from__1_4_0(from: Purge__1_4_0): v1_5_0_Operation_Purge {
    return new v1_5_0_Operation_Purge (
        from.sessionId
    )
}