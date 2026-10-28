import {Operation_Related as api_Operation_Related} from './Operation.js'
import {Operation_Related as Related__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__related__from__1_6_0(from: Related__1_6_0): api_Operation_Related {
    return new api_Operation_Related (
        from.sessionId,
        from.limit
    )
}