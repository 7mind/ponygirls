import {Operation_GetSession as GetSession__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_GetSession as v1_6_0_Operation_GetSession} from './Operation.js'
import {convert__content_view__from__1_5_0} from './from_1_5_0_content-view.js'

export function convert__operation__get_session__from__1_5_0(from: GetSession__1_5_0): v1_6_0_Operation_GetSession {
    return new v1_6_0_Operation_GetSession (
        from.sessionId,
        (from.view === undefined ? undefined : convert__content_view__from__1_5_0(from.view))
    )
}