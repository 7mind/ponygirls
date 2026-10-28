import {Result_Pong as Pong__1_4_0} from '../v1_4_0/Result.js'
import {Result_Pong as v1_5_0_Result_Pong} from './Result.js'

export function convert__result__pong__from__1_4_0(from: Pong__1_4_0): v1_5_0_Result_Pong {
    return new v1_5_0_Result_Pong (
        from.nonce
    )
}