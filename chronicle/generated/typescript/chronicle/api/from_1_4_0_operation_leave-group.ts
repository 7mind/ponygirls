import {Operation_LeaveGroup as api_Operation_LeaveGroup} from './Operation.js'
import {Operation_LeaveGroup as LeaveGroup__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__leave_group__from__1_4_0(from: LeaveGroup__1_4_0): api_Operation_LeaveGroup {
    return new api_Operation_LeaveGroup (
        from.groupId
    )
}