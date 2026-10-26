import {GroupInfo as api_GroupInfo} from './GroupInfo.js'
import {GroupInfo as GroupInfo__1_2_0} from './v1_2_0/GroupInfo.js'

export function convert__group_info__from__1_2_0(from: GroupInfo__1_2_0): api_GroupInfo {
    return new api_GroupInfo (
        from.id,
        from.name,
        from.ownerId,
        from.members
    )
}