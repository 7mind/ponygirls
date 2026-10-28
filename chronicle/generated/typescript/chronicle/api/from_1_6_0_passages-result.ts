import {PassagesResult as api_PassagesResult} from './PassagesResult.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'
import {convert__passage_format__from__1_6_0} from './from_1_6_0_passage-format.js'
import {convert__passage_info__from__1_6_0} from './from_1_6_0_passage-info.js'
import {PassagesResult as PassagesResult__1_6_0} from './v1_6_0/PassagesResult.js'

export function convert__passages_result__from__1_6_0(from: PassagesResult__1_6_0): api_PassagesResult {
    return new api_PassagesResult (
        convert__content_view__from__1_6_0(from.view),
        convert__passage_format__from__1_6_0(from.format),
        Array.from(from.passages, item => convert__passage_info__from__1_6_0(item)),
        from.total,
        from.offset
    )
}