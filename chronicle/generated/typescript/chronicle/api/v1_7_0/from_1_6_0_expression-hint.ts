import {ExpressionHint as ExpressionHint__1_6_0} from '../v1_6_0/ExpressionHint.js'
import {ExpressionHint as v1_7_0_ExpressionHint} from './ExpressionHint.js'
import {convert__expression_hint_kind__from__1_6_0} from './from_1_6_0_expression-hint-kind.js'

export function convert__expression_hint__from__1_6_0(from: ExpressionHint__1_6_0): v1_7_0_ExpressionHint {
    return new v1_7_0_ExpressionHint (
        convert__expression_hint_kind__from__1_6_0(from.kind),
        from.label,
        from.insertText,
        from.caretOffsetUtf16
    )
}