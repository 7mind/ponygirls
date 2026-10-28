import {PassagePoint as PassagePoint__1_5_0} from '../v1_5_0/PassagePoint.js'
import {PassagePoint as v1_6_0_PassagePoint} from './PassagePoint.js'

export function convert__passage_point__from__1_5_0(from: PassagePoint__1_5_0): v1_6_0_PassagePoint {
    return new v1_6_0_PassagePoint (
        from.messageId,
        from.messagePosition,
        from.byteOffset
    )
}