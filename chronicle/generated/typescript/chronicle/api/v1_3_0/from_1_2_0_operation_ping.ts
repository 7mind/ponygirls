import {Operation_Ping as Ping__1_2_0} from '../v1_2_0/Operation.js'
import {Operation_Ping as v1_3_0_Operation_Ping} from './Operation.js'

export function convert__operation__ping__from__1_2_0(from: Ping__1_2_0): v1_3_0_Operation_Ping {
    return new v1_3_0_Operation_Ping (
        from.nonce
    )
}