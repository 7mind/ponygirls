import {Result_Error as Error__1_5_0} from '../v1_5_0/Result.js'
import {Result_Error as v1_6_0_Result_Error} from './Result.js'
import {convert__failure__from__1_5_0} from './from_1_5_0_failure.js'

export function convert__result__error__from__1_5_0(from: Error__1_5_0): v1_6_0_Result_Error {
    return new v1_6_0_Result_Error (
        convert__failure__from__1_5_0(from.failure)
    )
}