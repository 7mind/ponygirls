import {PassageSpansResult as PassageSpansResult__1_5_0} from '../v1_5_0/PassageSpansResult.js'
import {PassageSpansResult as v1_6_0_PassageSpansResult} from './PassageSpansResult.js'
import {convert__content_view__from__1_5_0} from './from_1_5_0_content-view.js'
import {convert__passage_source_span__from__1_5_0} from './from_1_5_0_passage-source-span.js'

export function convert__passage_spans_result__from__1_5_0(from: PassageSpansResult__1_5_0): v1_6_0_PassageSpansResult {
    return new v1_6_0_PassageSpansResult (
        convert__content_view__from__1_5_0(from.view),
        from.passageId,
        Array.from(from.spans, item => convert__passage_source_span__from__1_5_0(item)),
        from.total,
        from.offset
    )
}