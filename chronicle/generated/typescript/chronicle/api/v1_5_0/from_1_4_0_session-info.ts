import {SessionInfo as SessionInfo__1_4_0} from '../v1_4_0/SessionInfo.js'
import {SessionInfo as v1_5_0_SessionInfo} from './SessionInfo.js'
import {convert__completion__from__1_4_0} from './from_1_4_0_completion.js'
import {convert__content_view__from__1_4_0} from './from_1_4_0_content-view.js'
import {convert__metadata__from__1_4_0} from './from_1_4_0_metadata.js'
import {convert__source_identity__from__1_4_0} from './from_1_4_0_source-identity.js'

export function convert__session_info__from__1_4_0(from: SessionInfo__1_4_0): v1_5_0_SessionInfo {
    return new v1_5_0_SessionInfo (
        convert__content_view__from__1_4_0(from.view),
        from.id,
        from.ownerId,
        from.revision,
        from.indexedRevision,
        convert__metadata__from__1_4_0(from.metadata),
        convert__source_identity__from__1_4_0(from.source),
        convert__completion__from__1_4_0(from.completion),
        from.redacted
    )
}