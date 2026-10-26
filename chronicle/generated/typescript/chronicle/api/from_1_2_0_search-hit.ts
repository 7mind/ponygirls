import {SearchHit as api_SearchHit} from './SearchHit.js'
import {convert__chunk__from__1_2_0} from './from_1_2_0_chunk.js'
import {convert__session_info__from__1_2_0} from './from_1_2_0_session-info.js'
import {SearchHit as SearchHit__1_2_0} from './v1_2_0/SearchHit.js'

export function convert__search_hit__from__1_2_0(from: SearchHit__1_2_0): api_SearchHit {
    return new api_SearchHit (
        convert__session_info__from__1_2_0(from.session),
        Array.from(from.chunks, item => convert__chunk__from__1_2_0(item)),
        from.score
    )
}