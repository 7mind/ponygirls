import {GroupInfo as GroupInfo__1_1_0} from '../v1_1_0/GroupInfo.js'
import {GroupInfo as v1_2_0_GroupInfo} from './GroupInfo.js'

export function convert__group_info__from__1_1_0(from: GroupInfo__1_1_0): v1_2_0_GroupInfo {
    return new v1_2_0_GroupInfo (
        from.id,
        from.name,
        from.ownerId,
        from.members
    )
}