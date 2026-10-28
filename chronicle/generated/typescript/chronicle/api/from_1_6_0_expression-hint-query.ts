import {ExpressionHintQuery as api_ExpressionHintQuery} from './ExpressionHintQuery.js'
import {convert__expression_hint_target__from__1_6_0} from './from_1_6_0_expression-hint-target.js'
import {ExpressionHintQuery as ExpressionHintQuery__1_6_0} from './v1_6_0/ExpressionHintQuery.js'

export function convert__expression_hint_query__from__1_6_0(from: ExpressionHintQuery__1_6_0): api_ExpressionHintQuery {
    return new api_ExpressionHintQuery (
        convert__expression_hint_target__from__1_6_0(from.target),
        from.expression,
        from.caretUtf16,
        from.limit
    )
}