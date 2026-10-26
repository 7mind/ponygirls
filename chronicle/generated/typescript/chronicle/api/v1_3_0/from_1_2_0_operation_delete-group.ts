import {Operation_DeleteGroup as DeleteGroup__1_2_0} from '../v1_2_0/Operation.js'
import {Operation_DeleteGroup as v1_3_0_Operation_DeleteGroup} from './Operation.js'

export function convert__operation__delete_group__from__1_2_0(from: DeleteGroup__1_2_0): v1_3_0_Operation_DeleteGroup {
    return new v1_3_0_Operation_DeleteGroup (
        from.groupId
    )
}