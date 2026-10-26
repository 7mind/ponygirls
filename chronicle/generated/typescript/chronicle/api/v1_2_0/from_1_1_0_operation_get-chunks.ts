import {Operation_GetChunks as GetChunks__1_1_0} from '../v1_1_0/Operation.js'
import {Operation_GetChunks as v1_2_0_Operation_GetChunks} from './Operation.js'
import {convert__content_view__from__1_1_0} from './from_1_1_0_content-view.js'

export function convert__operation__get_chunks__from__1_1_0(from: GetChunks__1_1_0): v1_2_0_Operation_GetChunks {
    return new v1_2_0_Operation_GetChunks (
        from.sessionId,
        from.offset,
        from.limit,
        (from.view === undefined ? undefined : convert__content_view__from__1_1_0(from.view))
    )
}