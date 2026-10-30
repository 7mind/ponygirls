import {Operation_Ping as Ping__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_Ping as v1_7_0_Operation_Ping} from './Operation.js'

export function convert__operation__ping__from__1_6_0(from: Ping__1_6_0): v1_7_0_Operation_Ping {
    return new v1_7_0_Operation_Ping (
        from.nonce
    )
}