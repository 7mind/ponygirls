import {Operation_Ping as api_Operation_Ping} from './Operation.js'
import {Operation_Ping as Ping__1_3_0} from './v1_3_0/Operation.js'

export function convert__operation__ping__from__1_3_0(from: Ping__1_3_0): api_Operation_Ping {
    return new api_Operation_Ping (
        from.nonce
    )
}