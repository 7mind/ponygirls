import {Operation_GetSession as GetSession__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_GetSession as v1_5_0_Operation_GetSession} from './Operation.js'
import {convert__content_view__from__1_4_0} from './from_1_4_0_content-view.js'

export function convert__operation__get_session__from__1_4_0(from: GetSession__1_4_0): v1_5_0_Operation_GetSession {
    return new v1_5_0_Operation_GetSession (
        from.sessionId,
        (from.view === undefined ? undefined : convert__content_view__from__1_4_0(from.view))
    )
}