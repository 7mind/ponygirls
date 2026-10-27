import {Result_ModelUsage as api_Result_ModelUsage} from './Result.js'
import {convert__model_usage_result__from__1_4_0} from './from_1_4_0_model-usage-result.js'
import {Result_ModelUsage as ModelUsage__1_4_0} from './v1_4_0/Result.js'

export function convert__result__model_usage__from__1_4_0(from: ModelUsage__1_4_0): api_Result_ModelUsage {
    return new api_Result_ModelUsage (
        convert__model_usage_result__from__1_4_0(from.result)
    )
}