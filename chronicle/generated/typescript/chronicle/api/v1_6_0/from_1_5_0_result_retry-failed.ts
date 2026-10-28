import {Result_RetryFailed as RetryFailed__1_5_0} from '../v1_5_0/Result.js'
import {Result_RetryFailed as v1_6_0_Result_RetryFailed} from './Result.js'
import {convert__retry_failed_result__from__1_5_0} from './from_1_5_0_retry-failed-result.js'

export function convert__result__retry_failed__from__1_5_0(from: RetryFailed__1_5_0): v1_6_0_Result_RetryFailed {
    return new v1_6_0_Result_RetryFailed (
        convert__retry_failed_result__from__1_5_0(from.result)
    )
}