import {Operation_DeleteGroup as DeleteGroup__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_DeleteGroup as v1_5_0_Operation_DeleteGroup} from './Operation.js'

export function convert__operation__delete_group__from__1_4_0(from: DeleteGroup__1_4_0): v1_5_0_Operation_DeleteGroup {
    return new v1_5_0_Operation_DeleteGroup (
        from.groupId
    )
}