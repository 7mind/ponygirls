import {ExpressionHint as ExpressionHint__1_4_0} from '../v1_4_0/ExpressionHint.js'
import {ExpressionHint as v1_5_0_ExpressionHint} from './ExpressionHint.js'
import {convert__expression_hint_kind__from__1_4_0} from './from_1_4_0_expression-hint-kind.js'

export function convert__expression_hint__from__1_4_0(from: ExpressionHint__1_4_0): v1_5_0_ExpressionHint {
    return new v1_5_0_ExpressionHint (
        convert__expression_hint_kind__from__1_4_0(from.kind),
        from.label,
        from.insertText,
        from.caretOffsetUtf16
    )
}