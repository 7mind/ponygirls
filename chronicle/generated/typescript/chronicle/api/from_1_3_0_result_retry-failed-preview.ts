import {Result_RetryFailedPreview as api_Result_RetryFailedPreview} from './Result.js'
import {convert__retry_failed_plan__from__1_3_0} from './from_1_3_0_retry-failed-plan.js'
import {Result_RetryFailedPreview as RetryFailedPreview__1_3_0} from './v1_3_0/Result.js'

export function convert__result__retry_failed_preview__from__1_3_0(from: RetryFailedPreview__1_3_0): api_Result_RetryFailedPreview {
    return new api_Result_RetryFailedPreview (
        convert__retry_failed_plan__from__1_3_0(from.result)
    )
}