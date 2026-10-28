import {Operation_LeaveGroup as LeaveGroup__1_5_0} from '../v1_5_0/Operation.js'
import {Operation_LeaveGroup as v1_6_0_Operation_LeaveGroup} from './Operation.js'

export function convert__operation__leave_group__from__1_5_0(from: LeaveGroup__1_5_0): v1_6_0_Operation_LeaveGroup {
    return new v1_6_0_Operation_LeaveGroup (
        from.groupId
    )
}