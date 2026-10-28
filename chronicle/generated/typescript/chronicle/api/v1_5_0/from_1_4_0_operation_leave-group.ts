import {Operation_LeaveGroup as LeaveGroup__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_LeaveGroup as v1_5_0_Operation_LeaveGroup} from './Operation.js'

export function convert__operation__leave_group__from__1_4_0(from: LeaveGroup__1_4_0): v1_5_0_Operation_LeaveGroup {
    return new v1_5_0_Operation_LeaveGroup (
        from.groupId
    )
}