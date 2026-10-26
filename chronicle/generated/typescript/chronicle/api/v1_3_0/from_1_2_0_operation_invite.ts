import {Operation_Invite as Invite__1_2_0} from '../v1_2_0/Operation.js'
import {Operation_Invite as v1_3_0_Operation_Invite} from './Operation.js'

export function convert__operation__invite__from__1_2_0(from: Invite__1_2_0): v1_3_0_Operation_Invite {
    return new v1_3_0_Operation_Invite (
        from.groupId,
        from.targetId
    )
}