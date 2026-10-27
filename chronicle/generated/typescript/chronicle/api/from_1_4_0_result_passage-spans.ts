import {Result_PassageSpans as api_Result_PassageSpans} from './Result.js'
import {convert__passage_spans_result__from__1_4_0} from './from_1_4_0_passage-spans-result.js'
import {Result_PassageSpans as PassageSpans__1_4_0} from './v1_4_0/Result.js'

export function convert__result__passage_spans__from__1_4_0(from: PassageSpans__1_4_0): api_Result_PassageSpans {
    return new api_Result_PassageSpans (
        convert__passage_spans_result__from__1_4_0(from.result)
    )
}