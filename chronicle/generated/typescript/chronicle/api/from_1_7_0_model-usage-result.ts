import {ModelUsageResult as api_ModelUsageResult} from './ModelUsageResult.js'
import {convert__indexing_settings__from__1_7_0} from './from_1_7_0_indexing-settings.js'
import {convert__model_rate_basis__from__1_7_0} from './from_1_7_0_model-rate-basis.js'
import {convert__model_usage_slice__from__1_7_0} from './from_1_7_0_model-usage-slice.js'
import {ModelUsageResult as ModelUsageResult__1_7_0} from './v1_7_0/ModelUsageResult.js'

export function convert__model_usage_result__from__1_7_0(from: ModelUsageResult__1_7_0): api_ModelUsageResult {
    return new api_ModelUsageResult (
        from.observedAt,
        from.processStartedAt,
        from.windowStartAt,
        from.windowEndAt,
        from.coveredMillis,
        convert__model_rate_basis__from__1_7_0(from.basis),
        convert__indexing_settings__from__1_7_0(from.settings),
        Array.from(from.samples, item => convert__model_usage_slice__from__1_7_0(item))
    )
}