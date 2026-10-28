import {PassagePoint as api_PassagePoint} from './PassagePoint.js'
import {PassagePoint as PassagePoint__1_6_0} from './v1_6_0/PassagePoint.js'

export function convert__passage_point__from__1_6_0(from: PassagePoint__1_6_0): api_PassagePoint {
    return new api_PassagePoint (
        from.messageId,
        from.messagePosition,
        from.byteOffset
    )
}