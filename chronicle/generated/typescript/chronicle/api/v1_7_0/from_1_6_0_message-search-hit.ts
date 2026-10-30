import {MessageSearchHit as MessageSearchHit__1_6_0} from '../v1_6_0/MessageSearchHit.js'
import {MessageSearchHit as v1_7_0_MessageSearchHit} from './MessageSearchHit.js'

export function convert__message_search_hit__from__1_6_0(from: MessageSearchHit__1_6_0): v1_7_0_MessageSearchHit {
    return new v1_7_0_MessageSearchHit (
        from.messageId,
        from.position
    )
}