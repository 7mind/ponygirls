import {PassageInfo as PassageInfo__1_5_0} from '../v1_5_0/PassageInfo.js'
import {PassageInfo as v1_6_0_PassageInfo} from './PassageInfo.js'
import {convert__passage_point__from__1_5_0} from './from_1_5_0_passage-point.js'

export function convert__passage_info__from__1_5_0(from: PassageInfo__1_5_0): v1_6_0_PassageInfo {
    return new v1_6_0_PassageInfo (
        from.id,
        from.ordinal,
        from.summary,
        from.tags,
        convert__passage_point__from__1_5_0(from.start),
        convert__passage_point__from__1_5_0(from.end),
        from.sourceBytes,
        from.spanCount,
        from.pieceCount
    )
}