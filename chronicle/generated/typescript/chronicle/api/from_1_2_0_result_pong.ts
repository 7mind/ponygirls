import {Result_Pong as api_Result_Pong} from './Result.js'
import {Result_Pong as Pong__1_2_0} from './v1_2_0/Result.js'

export function convert__result__pong__from__1_2_0(from: Pong__1_2_0): api_Result_Pong {
    return new api_Result_Pong (
        from.nonce
    )
}