import {Result_Ping as Ping__1_5_0} from '../v1_5_0/Result.js'
import {Result_Ping as v1_6_0_Result_Ping} from './Result.js'

export function convert__result__ping__from__1_5_0(from: Ping__1_5_0): v1_6_0_Result_Ping {
    return new v1_6_0_Result_Ping (
        from.nonce
    )
}