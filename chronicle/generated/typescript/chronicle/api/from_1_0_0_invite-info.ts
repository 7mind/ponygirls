import {InviteInfo as api_InviteInfo} from './InviteInfo.js'
import {InviteInfo as InviteInfo__1_0_0} from './v1_0_0/InviteInfo.js'

export function convert__invite_info__from__1_0_0(from: InviteInfo__1_0_0): api_InviteInfo {
    return new api_InviteInfo (
        from.id,
        from.groupId,
        from.targetId,
        from.expiresAt
    )
}