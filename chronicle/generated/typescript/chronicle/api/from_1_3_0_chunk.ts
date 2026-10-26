import {Chunk as api_Chunk} from './Chunk.js'
import {convert__span__from__1_3_0} from './from_1_3_0_span.js'
import {Chunk as Chunk__1_3_0} from './v1_3_0/Chunk.js'

export function convert__chunk__from__1_3_0(from: Chunk__1_3_0): api_Chunk {
    return new api_Chunk (
        from.id,
        from.sessionId,
        from.text,
        from.summary,
        from.tags,
        Array.from(from.spans, item => convert__span__from__1_3_0(item)),
        from.score
    )
}