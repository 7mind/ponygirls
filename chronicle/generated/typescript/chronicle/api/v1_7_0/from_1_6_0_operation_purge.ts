import {Operation_Purge as Purge__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_Purge as v1_7_0_Operation_Purge} from './Operation.js'

export function convert__operation__purge__from__1_6_0(from: Purge__1_6_0): v1_7_0_Operation_Purge {
    return new v1_7_0_Operation_Purge (
        from.sessionId
    )
}