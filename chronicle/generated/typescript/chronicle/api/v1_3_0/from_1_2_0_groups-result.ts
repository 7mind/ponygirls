import {GroupsResult as GroupsResult__1_2_0} from '../v1_2_0/GroupsResult.js'
import {GroupsResult as v1_3_0_GroupsResult} from './GroupsResult.js'
import {convert__group_info__from__1_2_0} from './from_1_2_0_group-info.js'
import {convert__invite_info__from__1_2_0} from './from_1_2_0_invite-info.js'

export function convert__groups_result__from__1_2_0(from: GroupsResult__1_2_0): v1_3_0_GroupsResult {
    return new v1_3_0_GroupsResult (
        Array.from(from.groups, item => convert__group_info__from__1_2_0(item)),
        Array.from(from.invitations, item => convert__invite_info__from__1_2_0(item))
    )
}