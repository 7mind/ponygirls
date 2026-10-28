import {Result_ModelUsage as ModelUsage__1_5_0} from '../v1_5_0/Result.js'
import {Result_ModelUsage as v1_6_0_Result_ModelUsage} from './Result.js'
import {convert__model_usage_result__from__1_5_0} from './from_1_5_0_model-usage-result.js'

export function convert__result__model_usage__from__1_5_0(from: ModelUsage__1_5_0): v1_6_0_Result_ModelUsage {
    return new v1_6_0_Result_ModelUsage (
        convert__model_usage_result__from__1_5_0(from.result)
    )
}