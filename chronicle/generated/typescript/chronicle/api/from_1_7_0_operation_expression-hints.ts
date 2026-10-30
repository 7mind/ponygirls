import {Operation_ExpressionHints as api_Operation_ExpressionHints} from './Operation.js'
import {convert__expression_hint_query__from__1_7_0} from './from_1_7_0_expression-hint-query.js'
import {Operation_ExpressionHints as ExpressionHints__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__expression_hints__from__1_7_0(from: ExpressionHints__1_7_0): api_Operation_ExpressionHints {
    return new api_Operation_ExpressionHints (
        convert__expression_hint_query__from__1_7_0(from.query)
    )
}