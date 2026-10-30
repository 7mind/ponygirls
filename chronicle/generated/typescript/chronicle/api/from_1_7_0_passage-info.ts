import {PassageInfo as api_PassageInfo} from './PassageInfo.js'
import {convert__passage_point__from__1_7_0} from './from_1_7_0_passage-point.js'
import {PassageInfo as PassageInfo__1_7_0} from './v1_7_0/PassageInfo.js'

export function convert__passage_info__from__1_7_0(from: PassageInfo__1_7_0): api_PassageInfo {
    return new api_PassageInfo (
        from.id,
        from.ordinal,
        from.summary,
        from.tags,
        convert__passage_point__from__1_7_0(from.start),
        convert__passage_point__from__1_7_0(from.end),
        from.sourceBytes,
        from.spanCount,
        from.pieceCount
    )
}