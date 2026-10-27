import {GroupsResult as GroupsResult__1_3_0} from '../v1_3_0/GroupsResult.js'
import {GroupsResult as v1_4_0_GroupsResult} from './GroupsResult.js'
import {convert__group_info__from__1_3_0} from './from_1_3_0_group-info.js'
import {convert__invite_info__from__1_3_0} from './from_1_3_0_invite-info.js'

export function convert__groups_result__from__1_3_0(from: GroupsResult__1_3_0): v1_4_0_GroupsResult {
    return new v1_4_0_GroupsResult (
        Array.from(from.groups, item => convert__group_info__from__1_3_0(item)),
        Array.from(from.invitations, item => convert__invite_info__from__1_3_0(item))
    )
}