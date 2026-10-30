import {Result_ExpressionHints as api_Result_ExpressionHints} from './Result.js'
import {convert__expression_hints_result__from__1_7_0} from './from_1_7_0_expression-hints-result.js'
import {Result_ExpressionHints as ExpressionHints__1_7_0} from './v1_7_0/Result.js'

export function convert__result__expression_hints__from__1_7_0(from: ExpressionHints__1_7_0): api_Result_ExpressionHints {
    return new api_Result_ExpressionHints (
        convert__expression_hints_result__from__1_7_0(from.result)
    )
}