import {ChunksResult as ChunksResult__1_2_0} from '../v1_2_0/ChunksResult.js'
import {ChunksResult as v1_3_0_ChunksResult} from './ChunksResult.js'
import {convert__chunk__from__1_2_0} from './from_1_2_0_chunk.js'
import {convert__content_view__from__1_2_0} from './from_1_2_0_content-view.js'

export function convert__chunks_result__from__1_2_0(from: ChunksResult__1_2_0): v1_3_0_ChunksResult {
    return new v1_3_0_ChunksResult (
        Array.from(from.chunks, item => convert__chunk__from__1_2_0(item)),
        from.total,
        from.offset,
        convert__content_view__from__1_2_0(from.view)
    )
}