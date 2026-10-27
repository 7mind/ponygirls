import {ExpressionHint as api_ExpressionHint} from './ExpressionHint.js'
import {convert__expression_hint_kind__from__1_4_0} from './from_1_4_0_expression-hint-kind.js'
import {ExpressionHint as ExpressionHint__1_4_0} from './v1_4_0/ExpressionHint.js'

export function convert__expression_hint__from__1_4_0(from: ExpressionHint__1_4_0): api_ExpressionHint {
    return new api_ExpressionHint (
        convert__expression_hint_kind__from__1_4_0(from.kind),
        from.label,
        from.insertText,
        from.caretOffsetUtf16
    )
}