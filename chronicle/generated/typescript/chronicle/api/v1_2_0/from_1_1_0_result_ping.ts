import {Result_Ping as Ping__1_1_0} from '../v1_1_0/Result.js'
import {Result_Ping as v1_2_0_Result_Ping} from './Result.js'

export function convert__result__ping__from__1_1_0(from: Ping__1_1_0): v1_2_0_Result_Ping {
    return new v1_2_0_Result_Ping (
        from.nonce
    )
}