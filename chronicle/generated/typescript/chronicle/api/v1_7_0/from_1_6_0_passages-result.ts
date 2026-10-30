import {PassagesResult as PassagesResult__1_6_0} from '../v1_6_0/PassagesResult.js'
import {PassagesResult as v1_7_0_PassagesResult} from './PassagesResult.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'
import {convert__passage_format__from__1_6_0} from './from_1_6_0_passage-format.js'
import {convert__passage_info__from__1_6_0} from './from_1_6_0_passage-info.js'

export function convert__passages_result__from__1_6_0(from: PassagesResult__1_6_0): v1_7_0_PassagesResult {
    return new v1_7_0_PassagesResult (
        convert__content_view__from__1_6_0(from.view),
        convert__passage_format__from__1_6_0(from.format),
        Array.from(from.passages, item => convert__passage_info__from__1_6_0(item)),
        from.total,
        from.offset
    )
}