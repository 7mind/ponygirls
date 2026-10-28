import {ExpressionHintQuery as ExpressionHintQuery__1_4_0} from '../v1_4_0/ExpressionHintQuery.js'
import {ExpressionHintQuery as v1_5_0_ExpressionHintQuery} from './ExpressionHintQuery.js'
import {convert__expression_hint_target__from__1_4_0} from './from_1_4_0_expression-hint-target.js'

export function convert__expression_hint_query__from__1_4_0(from: ExpressionHintQuery__1_4_0): v1_5_0_ExpressionHintQuery {
    return new v1_5_0_ExpressionHintQuery (
        convert__expression_hint_target__from__1_4_0(from.target),
        from.expression,
        from.caretUtf16,
        from.limit
    )
}