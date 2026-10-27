import {Result_Ping as Ping__1_3_0} from '../v1_3_0/Result.js'
import {Result_Ping as v1_4_0_Result_Ping} from './Result.js'

export function convert__result__ping__from__1_3_0(from: Ping__1_3_0): v1_4_0_Result_Ping {
    return new v1_4_0_Result_Ping (
        from.nonce
    )
}