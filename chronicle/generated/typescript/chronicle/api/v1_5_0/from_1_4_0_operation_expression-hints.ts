import {Operation_ExpressionHints as ExpressionHints__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_ExpressionHints as v1_5_0_Operation_ExpressionHints} from './Operation.js'
import {convert__expression_hint_query__from__1_4_0} from './from_1_4_0_expression-hint-query.js'

export function convert__operation__expression_hints__from__1_4_0(from: ExpressionHints__1_4_0): v1_5_0_Operation_ExpressionHints {
    return new v1_5_0_Operation_ExpressionHints (
        convert__expression_hint_query__from__1_4_0(from.query)
    )
}