import {Operation_Pong as api_Operation_Pong} from './Operation.js'
import {Operation_Pong as Pong__1_3_0} from './v1_3_0/Operation.js'

export function convert__operation__pong__from__1_3_0(from: Pong__1_3_0): api_Operation_Pong {
    return new api_Operation_Pong (
        from.nonce
    )
}