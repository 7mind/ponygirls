import {ModelUsageSlice as api_ModelUsageSlice} from './ModelUsageSlice.js'
import {convert__model_purpose__from__1_4_0} from './from_1_4_0_model-purpose.js'
import {convert__token_rate_window__from__1_4_0} from './from_1_4_0_token-rate-window.js'
import {ModelUsageSlice as ModelUsageSlice__1_4_0} from './v1_4_0/ModelUsageSlice.js'

export function convert__model_usage_slice__from__1_4_0(from: ModelUsageSlice__1_4_0): api_ModelUsageSlice {
    return new api_ModelUsageSlice (
        convert__model_purpose__from__1_4_0(from.purpose),
        from.inFlight,
        from.finishedCalls,
        from.failedCalls,
        from.cancelledCalls,
        from.invalidUsageCalls,
        convert__token_rate_window__from__1_4_0(from.input),
        (from.output === undefined ? undefined : convert__token_rate_window__from__1_4_0(from.output)),
        (from.reasoningSubset === undefined ? undefined : convert__token_rate_window__from__1_4_0(from.reasoningSubset))
    )
}