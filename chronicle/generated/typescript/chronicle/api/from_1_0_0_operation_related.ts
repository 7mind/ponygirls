import {Operation_Related as api_Operation_Related} from './Operation.js'
import {Operation_Related as Related__1_0_0} from './v1_0_0/Operation.js'

export function convert__operation__related__from__1_0_0(from: Related__1_0_0): api_Operation_Related {
    return new api_Operation_Related (
        from.sessionId,
        from.limit
    )
}