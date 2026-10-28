import {Result_Error as api_Result_Error} from './Result.js'
import {convert__failure__from__1_6_0} from './from_1_6_0_failure.js'
import {Result_Error as Error__1_6_0} from './v1_6_0/Result.js'

export function convert__result__error__from__1_6_0(from: Error__1_6_0): api_Result_Error {
    return new api_Result_Error (
        convert__failure__from__1_6_0(from.failure)
    )
}