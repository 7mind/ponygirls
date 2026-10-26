import {Operation_RemoveMember as api_Operation_RemoveMember} from './Operation.js'
import {Operation_RemoveMember as RemoveMember__1_2_0} from './v1_2_0/Operation.js'

export function convert__operation__remove_member__from__1_2_0(from: RemoveMember__1_2_0): api_Operation_RemoveMember {
    return new api_Operation_RemoveMember (
        from.groupId,
        from.userId
    )
}