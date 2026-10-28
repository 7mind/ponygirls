import {Operation_Ping as api_Operation_Ping} from './Operation.js'
import {Operation_Ping as Ping__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__ping__from__1_6_0(from: Ping__1_6_0): api_Operation_Ping {
    return new api_Operation_Ping (
        from.nonce
    )
}