import {SessionInfo as api_SessionInfo} from './SessionInfo.js'
import {convert__completion__from__1_0_0} from './from_1_0_0_completion.js'
import {convert__content_view__from__1_0_0} from './from_1_0_0_content-view.js'
import {convert__metadata__from__1_0_0} from './from_1_0_0_metadata.js'
import {convert__source_identity__from__1_0_0} from './from_1_0_0_source-identity.js'
import {SessionInfo as SessionInfo__1_0_0} from './v1_0_0/SessionInfo.js'

export function convert__session_info__from__1_0_0(from: SessionInfo__1_0_0): api_SessionInfo {
    return new api_SessionInfo (
        convert__content_view__from__1_0_0(from.view),
        from.id,
        from.ownerId,
        from.revision,
        from.indexedRevision,
        convert__metadata__from__1_0_0(from.metadata),
        convert__source_identity__from__1_0_0(from.source),
        convert__completion__from__1_0_0(from.completion),
        from.redacted
    )
}