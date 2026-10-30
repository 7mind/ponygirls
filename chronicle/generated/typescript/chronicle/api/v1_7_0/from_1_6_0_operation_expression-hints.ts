import {Operation_ExpressionHints as ExpressionHints__1_6_0} from '../v1_6_0/Operation.js'
import {Operation_ExpressionHints as v1_7_0_Operation_ExpressionHints} from './Operation.js'
import {convert__expression_hint_query__from__1_6_0} from './from_1_6_0_expression-hint-query.js'

export function convert__operation__expression_hints__from__1_6_0(from: ExpressionHints__1_6_0): v1_7_0_Operation_ExpressionHints {
    return new v1_7_0_Operation_ExpressionHints (
        convert__expression_hint_query__from__1_6_0(from.query)
    )
}