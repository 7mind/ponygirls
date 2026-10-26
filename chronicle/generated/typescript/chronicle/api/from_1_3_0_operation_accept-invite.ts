import {Operation_AcceptInvite as api_Operation_AcceptInvite} from './Operation.js'
import {Operation_AcceptInvite as AcceptInvite__1_3_0} from './v1_3_0/Operation.js'

export function convert__operation__accept_invite__from__1_3_0(from: AcceptInvite__1_3_0): api_Operation_AcceptInvite {
    return new api_Operation_AcceptInvite (
        from.invitationId,
        from.confirmSharing
    )
}