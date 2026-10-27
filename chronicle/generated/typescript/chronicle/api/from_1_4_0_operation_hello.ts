import {Operation_Hello as api_Operation_Hello} from './Operation.js'
import {Operation_Hello as Hello__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__hello__from__1_4_0(from: Hello__1_4_0): api_Operation_Hello {
    return new api_Operation_Hello (
        from.versions
    )
}