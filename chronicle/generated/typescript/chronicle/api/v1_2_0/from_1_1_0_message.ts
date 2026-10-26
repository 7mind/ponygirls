import {Message as Message__1_1_0} from '../v1_1_0/Message.js'
import {Message as v1_2_0_Message} from './Message.js'

export function convert__message__from__1_1_0(from: Message__1_1_0): v1_2_0_Message {
    return new v1_2_0_Message (
        from.id,
        from.parentId,
        from.role,
        from.text,
        from.timestamp,
        from.recordIndex
    )
}