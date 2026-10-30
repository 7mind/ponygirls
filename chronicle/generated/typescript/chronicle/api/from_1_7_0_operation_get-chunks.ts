import {Operation_GetChunks as api_Operation_GetChunks} from './Operation.js'
import {convert__content_view__from__1_7_0} from './from_1_7_0_content-view.js'
import {Operation_GetChunks as GetChunks__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__get_chunks__from__1_7_0(from: GetChunks__1_7_0): api_Operation_GetChunks {
    return new api_Operation_GetChunks (
        from.sessionId,
        from.offset,
        from.limit,
        (from.view === undefined ? undefined : convert__content_view__from__1_7_0(from.view))
    )
}