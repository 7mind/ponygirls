import {Operation_Hello as Hello__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_Hello as v1_7_0_Operation_Hello} from './Operation.js'

export function convert__operation__hello__from__1_6_0(from: Hello__1_6_0): v1_7_0_Operation_Hello {
    return new v1_7_0_Operation_Hello (
        from.versions
    )
}