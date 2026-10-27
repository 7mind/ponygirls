import {Result_Ping as api_Result_Ping} from './Result.js'
import {Result_Ping as Ping__1_4_0} from './v1_4_0/Result.js'

export function convert__result__ping__from__1_4_0(from: Ping__1_4_0): api_Result_Ping {
    return new api_Result_Ping (
        from.nonce
    )
}