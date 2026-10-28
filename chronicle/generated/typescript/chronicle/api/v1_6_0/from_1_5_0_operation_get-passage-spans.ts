import {Operation_GetPassageSpans as GetPassageSpans__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_GetPassageSpans as v1_6_0_Operation_GetPassageSpans} from './Operation.js'
import {convert__content_view__from__1_5_0} from './from_1_5_0_content-view.js'

export function convert__operation__get_passage_spans__from__1_5_0(from: GetPassageSpans__1_5_0): v1_6_0_Operation_GetPassageSpans {
    return new v1_6_0_Operation_GetPassageSpans (
        from.sessionId,
        convert__content_view__from__1_5_0(from.view),
        from.passageId,
        from.offset,
        from.limit
    )
}