import {Operation_Invite as Invite__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_Invite as v1_6_0_Operation_Invite} from './Operation.js'

export function convert__operation__invite__from__1_5_0(from: Invite__1_5_0): v1_6_0_Operation_Invite {
    return new v1_6_0_Operation_Invite (
        from.groupId,
        from.targetId
    )
}