import {Operation_Pong as Pong__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_Pong as v1_4_0_Operation_Pong} from './Operation.js'

export function convert__operation__pong__from__1_3_0(from: Pong__1_3_0): v1_4_0_Operation_Pong {
    return new v1_4_0_Operation_Pong (
        from.nonce
    )
}