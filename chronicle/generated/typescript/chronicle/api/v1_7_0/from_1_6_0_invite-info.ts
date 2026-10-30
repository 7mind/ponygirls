import {InviteInfo as InviteInfo__1_6_0} from '../v1_6_0/InviteInfo.js'
import {InviteInfo as v1_7_0_InviteInfo} from './InviteInfo.js'

export function convert__invite_info__from__1_6_0(from: InviteInfo__1_6_0): v1_7_0_InviteInfo {
    return new v1_7_0_InviteInfo (
        from.id,
        from.groupId,
        from.targetId,
        from.expiresAt
    )
}