import {Operation_DeleteGroup as api_Operation_DeleteGroup} from './Operation.js'
import {Operation_DeleteGroup as DeleteGroup__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__delete_group__from__1_4_0(from: DeleteGroup__1_4_0): api_Operation_DeleteGroup {
    return new api_Operation_DeleteGroup (
        from.groupId
    )
}