import {SearchHit as SearchHit__1_1_0} from '../v1_1_0/SearchHit.js'
import {SearchHit as v1_2_0_SearchHit} from './SearchHit.js'
import {convert__chunk__from__1_1_0} from './from_1_1_0_chunk.js'
import {convert__session_info__from__1_1_0} from './from_1_1_0_session-info.js'

export function convert__search_hit__from__1_1_0(from: SearchHit__1_1_0): v1_2_0_SearchHit {
    return new v1_2_0_SearchHit (
        convert__session_info__from__1_1_0(from.session),
        Array.from(from.chunks, item => convert__chunk__from__1_1_0(item)),
        from.score
    )
}