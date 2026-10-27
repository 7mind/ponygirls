import {Chunk as Chunk__1_3_0} from '../v1_3_0/Chunk.js'
import {Chunk as v1_4_0_Chunk} from './Chunk.js'
import {convert__span__from__1_3_0} from './from_1_3_0_span.js'

export function convert__chunk__from__1_3_0(from: Chunk__1_3_0): v1_4_0_Chunk {
    return new v1_4_0_Chunk (
        from.id,
        from.sessionId,
        from.text,
        from.summary,
        from.tags,
        Array.from(from.spans, item => convert__span__from__1_3_0(item)),
        from.score
    )
}