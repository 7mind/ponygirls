import {Result_RetryFailed as api_Result_RetryFailed} from './Result.js'
import {convert__retry_failed_result__from__1_3_0} from './from_1_3_0_retry-failed-result.js'
import {Result_RetryFailed as RetryFailed__1_3_0} from './v1_3_0/Result.js'

export function convert__result__retry_failed__from__1_3_0(from: RetryFailed__1_3_0): api_Result_RetryFailed {
    return new api_Result_RetryFailed (
        convert__retry_failed_result__from__1_3_0(from.result)
    )
}