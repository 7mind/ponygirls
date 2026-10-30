import {Result_ExpressionHints as ExpressionHints__1_6_0} from '../v1_6_0/Result.js'
import {Result_ExpressionHints as v1_7_0_Result_ExpressionHints} from './Result.js'
import {convert__expression_hints_result__from__1_6_0} from './from_1_6_0_expression-hints-result.js'

export function convert__result__expression_hints__from__1_6_0(from: ExpressionHints__1_6_0): v1_7_0_Result_ExpressionHints {
    return new v1_7_0_Result_ExpressionHints (
        convert__expression_hints_result__from__1_6_0(from.result)
    )
}