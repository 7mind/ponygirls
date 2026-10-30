import {MessageLocation as MessageLocation__1_6_0} from '../v1_6_0/MessageLocation.js'
import {MessageLocation as v1_7_0_MessageLocation} from './MessageLocation.js'
import {convert__content_view__from__1_6_0} from './from_1_6_0_content-view.js'

export function convert__message_location__from__1_6_0(from: MessageLocation__1_6_0): v1_7_0_MessageLocation {
    return new v1_7_0_MessageLocation (
        convert__content_view__from__1_6_0(from.view),
        from.position,
        from.total
    )
}