import {ExpressionHintsResult as api_ExpressionHintsResult} from './ExpressionHintsResult.js'
import {convert__expression_hint__from__1_7_0} from './from_1_7_0_expression-hint.js'
import {ExpressionHintsResult as ExpressionHintsResult__1_7_0} from './v1_7_0/ExpressionHintsResult.js'

export function convert__expression_hints_result__from__1_7_0(from: ExpressionHintsResult__1_7_0): api_ExpressionHintsResult {
    return new api_ExpressionHintsResult (
        from.queryHash,
        from.observedAt,
        from.replaceStartUtf16,
        from.replaceEndUtf16,
        Array.from(from.hints, item => convert__expression_hint__from__1_7_0(item)),
        from.truncated
    )
}