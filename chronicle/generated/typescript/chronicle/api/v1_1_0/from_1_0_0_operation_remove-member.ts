import {Operation_RemoveMember as RemoveMember__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_RemoveMember as v1_1_0_Operation_RemoveMember} from './Operation.js'

export function convert__operation__remove_member__from__1_0_0(from: RemoveMember__1_0_0): v1_1_0_Operation_RemoveMember {
    return new v1_1_0_Operation_RemoveMember (
        from.groupId,
        from.userId
    )
}