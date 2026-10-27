import {Operation_Invite as api_Operation_Invite} from './Operation.js'
import {Operation_Invite as Invite__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__invite__from__1_4_0(from: Invite__1_4_0): api_Operation_Invite {
    return new api_Operation_Invite (
        from.groupId,
        from.targetId
    )
}