import {Operation_Hello as Hello__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_Hello as v1_6_0_Operation_Hello} from './Operation.js'

export function convert__operation__hello__from__1_5_0(from: Hello__1_5_0): v1_6_0_Operation_Hello {
    return new v1_6_0_Operation_Hello (
        from.versions
    )
}