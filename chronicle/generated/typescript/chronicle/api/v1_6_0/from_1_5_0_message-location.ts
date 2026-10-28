import {MessageLocation as MessageLocation__1_5_0} from '../v1_5_0/MessageLocation.js'
import {MessageLocation as v1_6_0_MessageLocation} from './MessageLocation.js'
import {convert__content_view__from__1_5_0} from './from_1_5_0_content-view.js'

export function convert__message_location__from__1_5_0(from: MessageLocation__1_5_0): v1_6_0_MessageLocation {
    return new v1_6_0_MessageLocation (
        convert__content_view__from__1_5_0(from.view),
        from.position,
        from.total
    )
}