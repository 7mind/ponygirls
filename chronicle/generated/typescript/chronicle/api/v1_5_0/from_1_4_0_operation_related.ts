import {Operation_Related as Related__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_Related as v1_5_0_Operation_Related} from './Operation.js'

export function convert__operation__related__from__1_4_0(from: Related__1_4_0): v1_5_0_Operation_Related {
    return new v1_5_0_Operation_Related (
        from.sessionId,
        from.limit
    )
}