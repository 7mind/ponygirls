import {Message as api_Message} from './Message.js'
import {Message as Message__1_7_0} from './v1_7_0/Message.js'

export function convert__message__from__1_7_0(from: Message__1_7_0): api_Message {
    return new api_Message (
        from.id,
        from.parentId,
        from.role,
        from.text,
        from.timestamp,
        from.recordIndex
    )
}