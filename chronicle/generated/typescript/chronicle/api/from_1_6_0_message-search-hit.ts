import {MessageSearchHit as api_MessageSearchHit} from './MessageSearchHit.js'
import {MessageSearchHit as MessageSearchHit__1_6_0} from './v1_6_0/MessageSearchHit.js'

export function convert__message_search_hit__from__1_6_0(from: MessageSearchHit__1_6_0): api_MessageSearchHit {
    return new api_MessageSearchHit (
        from.messageId,
        from.position
    )
}