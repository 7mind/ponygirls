import {Result_Pong as Pong__1_5_0} from '../v1_5_0/Result.js'
import {Result_Pong as v1_6_0_Result_Pong} from './Result.js'

export function convert__result__pong__from__1_5_0(from: Pong__1_5_0): v1_6_0_Result_Pong {
    return new v1_6_0_Result_Pong (
        from.nonce
    )
}