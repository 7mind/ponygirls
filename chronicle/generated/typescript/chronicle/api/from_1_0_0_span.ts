import {Span as api_Span} from './Span.js'
import {Span as Span__1_0_0} from './v1_0_0/Span.js'

export function convert__span__from__1_0_0(from: Span__1_0_0): api_Span {
    return new api_Span (
        from.messageId,
        from.start,
        from.end
    )
}