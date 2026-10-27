import {Operation_ApplyRetryFailed as ApplyRetryFailed__1_3_0} from '../v1_3_0/Operation.js'
import {Operation_ApplyRetryFailed as v1_4_0_Operation_ApplyRetryFailed} from './Operation.js'

export function convert__operation__apply_retry_failed__from__1_3_0(from: ApplyRetryFailed__1_3_0): v1_4_0_Operation_ApplyRetryFailed {
    return new v1_4_0_Operation_ApplyRetryFailed (
        from.targetProfile,
        from.selectionHash,
        from.confirm
    )
}