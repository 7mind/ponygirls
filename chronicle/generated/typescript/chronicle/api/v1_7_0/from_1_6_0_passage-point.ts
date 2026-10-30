import {PassagePoint as PassagePoint__1_6_0} from '../v1_6_0/PassagePoint.js'
import {PassagePoint as v1_7_0_PassagePoint} from './PassagePoint.js'

export function convert__passage_point__from__1_6_0(from: PassagePoint__1_6_0): v1_7_0_PassagePoint {
    return new v1_7_0_PassagePoint (
        from.messageId,
        from.messagePosition,
        from.byteOffset
    )
}