import {Operation_GetSession as api_Operation_GetSession} from './Operation.js'
import {convert__content_view__from__1_1_0} from './from_1_1_0_content-view.js'
import {Operation_GetSession as GetSession__1_1_0} from './v1_1_0/Operation.js'

export function convert__operation__get_session__from__1_1_0(from: GetSession__1_1_0): api_Operation_GetSession {
    return new api_Operation_GetSession (
        from.sessionId,
        (from.view === undefined ? undefined : convert__content_view__from__1_1_0(from.view))
    )
}