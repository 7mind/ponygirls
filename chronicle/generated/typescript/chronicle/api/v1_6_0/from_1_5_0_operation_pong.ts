import {Operation_Pong as Pong__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_Pong as v1_6_0_Operation_Pong} from './Operation.js'

export function convert__operation__pong__from__1_5_0(from: Pong__1_5_0): v1_6_0_Operation_Pong {
    return new v1_6_0_Operation_Pong (
        from.nonce
    )
}