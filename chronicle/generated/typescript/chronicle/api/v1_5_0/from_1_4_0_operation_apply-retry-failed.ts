import {Operation_ApplyRetryFailed as ApplyRetryFailed__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_ApplyRetryFailed as v1_5_0_Operation_ApplyRetryFailed} from './Operation.js'

export function convert__operation__apply_retry_failed__from__1_4_0(from: ApplyRetryFailed__1_4_0): v1_5_0_Operation_ApplyRetryFailed {
    return new v1_5_0_Operation_ApplyRetryFailed (
        from.targetProfile,
        from.selectionHash,
        from.confirm
    )
}