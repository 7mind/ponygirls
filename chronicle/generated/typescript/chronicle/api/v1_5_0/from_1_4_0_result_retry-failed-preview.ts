import {Result_RetryFailedPreview as RetryFailedPreview__1_4_0} from '../v1_4_0/Result.js'
import {Result_RetryFailedPreview as v1_5_0_Result_RetryFailedPreview} from './Result.js'
import {convert__retry_failed_plan__from__1_4_0} from './from_1_4_0_retry-failed-plan.js'

export function convert__result__retry_failed_preview__from__1_4_0(from: RetryFailedPreview__1_4_0): v1_5_0_Result_RetryFailedPreview {
    return new v1_5_0_Result_RetryFailedPreview (
        convert__retry_failed_plan__from__1_4_0(from.result)
    )
}