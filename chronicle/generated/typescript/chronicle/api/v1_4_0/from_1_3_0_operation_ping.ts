import {Operation_Ping as Ping__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_Ping as v1_4_0_Operation_Ping} from './Operation.js'

export function convert__operation__ping__from__1_3_0(from: Ping__1_3_0): v1_4_0_Operation_Ping {
    return new v1_4_0_Operation_Ping (
        from.nonce
    )
}