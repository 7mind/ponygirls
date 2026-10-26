import {Operation_GetSession as GetSession__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_GetSession as v1_1_0_Operation_GetSession} from './Operation.js'
import {convert__content_view__from__1_0_0} from './from_1_0_0_content-view.js'

export function convert__operation__get_session__from__1_0_0(from: GetSession__1_0_0): v1_1_0_Operation_GetSession {
    return new v1_1_0_Operation_GetSession (
        from.sessionId,
        (from.view === undefined ? undefined : convert__content_view__from__1_0_0(from.view))
    )
}