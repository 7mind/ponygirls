import {PassageSourceSpan as api_PassageSourceSpan} from './PassageSourceSpan.js'
import {PassageSourceSpan as PassageSourceSpan__1_7_0} from './v1_7_0/PassageSourceSpan.js'

export function convert__passage_source_span__from__1_7_0(from: PassageSourceSpan__1_7_0): api_PassageSourceSpan {
    return new api_PassageSourceSpan (
        from.messageId,
        from.messagePosition,
        from.start,
        from.end
    )
}