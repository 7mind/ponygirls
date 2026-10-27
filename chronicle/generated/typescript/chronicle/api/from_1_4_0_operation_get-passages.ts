import {Operation_GetPassages as api_Operation_GetPassages} from './Operation.js'
import {convert__content_view__from__1_4_0} from './from_1_4_0_content-view.js'
import {Operation_GetPassages as GetPassages__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__get_passages__from__1_4_0(from: GetPassages__1_4_0): api_Operation_GetPassages {
    return new api_Operation_GetPassages (
        from.sessionId,
        convert__content_view__from__1_4_0(from.view),
        from.offset,
        from.limit
    )
}