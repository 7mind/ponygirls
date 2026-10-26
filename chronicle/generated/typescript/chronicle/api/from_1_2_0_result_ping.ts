import {Result_Ping as api_Result_Ping} from './Result.js'
import {Result_Ping as Ping__1_2_0} from './v1_2_0/Result.js'

export function convert__result__ping__from__1_2_0(from: Ping__1_2_0): api_Result_Ping {
    return new api_Result_Ping (
        from.nonce
    )
}