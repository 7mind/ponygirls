import {Operation_RemoveMember as RemoveMember__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_RemoveMember as v1_4_0_Operation_RemoveMember} from './Operation.js'

export function convert__operation__remove_member__from__1_3_0(from: RemoveMember__1_3_0): v1_4_0_Operation_RemoveMember {
    return new v1_4_0_Operation_RemoveMember (
        from.groupId,
        from.userId
    )
}