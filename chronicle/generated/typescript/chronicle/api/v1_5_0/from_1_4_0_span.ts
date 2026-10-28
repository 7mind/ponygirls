import {Span as Span__1_4_0} from '../v1_4_0/Span.js'
import {Span as v1_5_0_Span} from './Span.js'

export function convert__span__from__1_4_0(from: Span__1_4_0): v1_5_0_Span {
    return new v1_5_0_Span (
        from.messageId,
        from.start,
        from.end
    )
}