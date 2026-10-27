import {MessageLocation as api_MessageLocation} from './MessageLocation.js'
import {convert__content_view__from__1_4_0} from './from_1_4_0_content-view.js'
import {MessageLocation as MessageLocation__1_4_0} from './v1_4_0/MessageLocation.js'

export function convert__message_location__from__1_4_0(from: MessageLocation__1_4_0): api_MessageLocation {
    return new api_MessageLocation (
        convert__content_view__from__1_4_0(from.view),
        from.position,
        from.total
    )
}