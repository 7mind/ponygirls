import {ModelUsageResult as ModelUsageResult__1_6_0} from '../v1_6_0/ModelUsageResult.js'
import {ModelUsageResult as v1_7_0_ModelUsageResult} from './ModelUsageResult.js'
import {convert__indexing_settings__from__1_6_0} from './from_1_6_0_indexing-settings.js'
import {convert__model_rate_basis__from__1_6_0} from './from_1_6_0_model-rate-basis.js'
import {convert__model_usage_slice__from__1_6_0} from './from_1_6_0_model-usage-slice.js'

export function convert__model_usage_result__from__1_6_0(from: ModelUsageResult__1_6_0): v1_7_0_ModelUsageResult {
    return new v1_7_0_ModelUsageResult (
        from.observedAt,
        from.processStartedAt,
        from.windowStartAt,
        from.windowEndAt,
        from.coveredMillis,
        convert__model_rate_basis__from__1_6_0(from.basis),
        convert__indexing_settings__from__1_6_0(from.settings),
        Array.from(from.samples, item => convert__model_usage_slice__from__1_6_0(item))
    )
}