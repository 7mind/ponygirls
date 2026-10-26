import {Operation_CreateGroup as CreateGroup__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_CreateGroup as v1_1_0_Operation_CreateGroup} from './Operation.js'

export function convert__operation__create_group__from__1_0_0(from: CreateGroup__1_0_0): v1_1_0_Operation_CreateGroup {
    return new v1_1_0_Operation_CreateGroup (
        from.name
    )
}