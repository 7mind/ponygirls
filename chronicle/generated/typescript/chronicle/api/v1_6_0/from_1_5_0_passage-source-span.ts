import {PassageSourceSpan as PassageSourceSpan__1_5_0} from '../v1_5_0/PassageSourceSpan.js'
import {PassageSourceSpan as v1_6_0_PassageSourceSpan} from './PassageSourceSpan.js'

export function convert__passage_source_span__from__1_5_0(from: PassageSourceSpan__1_5_0): v1_6_0_PassageSourceSpan {
    return new v1_6_0_PassageSourceSpan (
        from.messageId,
        from.messagePosition,
        from.start,
        from.end
    )
}