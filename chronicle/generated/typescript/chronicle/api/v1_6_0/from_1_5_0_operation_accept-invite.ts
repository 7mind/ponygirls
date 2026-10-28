import {Operation_AcceptInvite as AcceptInvite__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_AcceptInvite as v1_6_0_Operation_AcceptInvite} from './Operation.js'

export function convert__operation__accept_invite__from__1_5_0(from: AcceptInvite__1_5_0): v1_6_0_Operation_AcceptInvite {
    return new v1_6_0_Operation_AcceptInvite (
        from.invitationId,
        from.confirmSharing
    )
}