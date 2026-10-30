import {PassageSpansResult as api_PassageSpansResult} from './PassageSpansResult.js'
import {convert__content_view__from__1_7_0} from './from_1_7_0_content-view.js'
import {convert__passage_source_span__from__1_7_0} from './from_1_7_0_passage-source-span.js'
import {PassageSpansResult as PassageSpansResult__1_7_0} from './v1_7_0/PassageSpansResult.js'

export function convert__passage_spans_result__from__1_7_0(from: PassageSpansResult__1_7_0): api_PassageSpansResult {
    return new api_PassageSpansResult (
        convert__content_view__from__1_7_0(from.view),
        from.passageId,
        Array.from(from.spans, item => convert__passage_source_span__from__1_7_0(item)),
        from.total,
        from.offset
    )
}