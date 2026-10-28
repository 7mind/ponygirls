import {ExpressionHintsResult as ExpressionHintsResult__1_4_0} from '../v1_4_0/ExpressionHintsResult.js'
import {ExpressionHintsResult as v1_5_0_ExpressionHintsResult} from './ExpressionHintsResult.js'
import {convert__expression_hint__from__1_4_0} from './from_1_4_0_expression-hint.js'

export function convert__expression_hints_result__from__1_4_0(from: ExpressionHintsResult__1_4_0): v1_5_0_ExpressionHintsResult {
    return new v1_5_0_ExpressionHintsResult (
        from.queryHash,
        from.observedAt,
        from.replaceStartUtf16,
        from.replaceEndUtf16,
        Array.from(from.hints, item => convert__expression_hint__from__1_4_0(item)),
        from.truncated
    )
}