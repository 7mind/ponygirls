import {ChunksResult as api_ChunksResult} from './ChunksResult.js'
import {convert__chunk__from__1_0_0} from './from_1_0_0_chunk.js'
import {convert__content_view__from__1_0_0} from './from_1_0_0_content-view.js'
import {ChunksResult as ChunksResult__1_0_0} from './v1_0_0/ChunksResult.js'

export function convert__chunks_result__from__1_0_0(from: ChunksResult__1_0_0): api_ChunksResult {
    return new api_ChunksResult (
        Array.from(from.chunks, item => convert__chunk__from__1_0_0(item)),
        from.total,
        from.offset,
        convert__content_view__from__1_0_0(from.view)
    )
}