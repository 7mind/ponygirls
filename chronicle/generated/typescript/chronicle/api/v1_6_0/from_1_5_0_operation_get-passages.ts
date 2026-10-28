import {Operation_GetPassages as GetPassages__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_GetPassages as v1_6_0_Operation_GetPassages} from './Operation.js'
import {convert__content_view__from__1_5_0} from './from_1_5_0_content-view.js'

export function convert__operation__get_passages__from__1_5_0(from: GetPassages__1_5_0): v1_6_0_Operation_GetPassages {
    return new v1_6_0_Operation_GetPassages (
        from.sessionId,
        convert__content_view__from__1_5_0(from.view),
        from.offset,
        from.limit
    )
}