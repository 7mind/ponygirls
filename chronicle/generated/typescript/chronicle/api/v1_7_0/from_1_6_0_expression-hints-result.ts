import {ExpressionHintsResult as ExpressionHintsResult__1_6_0} from '../v1_6_0/ExpressionHintsResult.js'
import {ExpressionHintsResult as v1_7_0_ExpressionHintsResult} from './ExpressionHintsResult.js'
import {convert__expression_hint__from__1_6_0} from './from_1_6_0_expression-hint.js'

export function convert__expression_hints_result__from__1_6_0(from: ExpressionHintsResult__1_6_0): v1_7_0_ExpressionHintsResult {
    return new v1_7_0_ExpressionHintsResult (
        from.queryHash,
        from.observedAt,
        from.replaceStartUtf16,
        from.replaceEndUtf16,
        Array.from(from.hints, item => convert__expression_hint__from__1_6_0(item)),
        from.truncated
    )
}