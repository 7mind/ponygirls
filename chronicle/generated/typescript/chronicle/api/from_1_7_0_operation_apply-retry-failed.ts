import {Operation_ApplyRetryFailed as api_Operation_ApplyRetryFailed} from './Operation.js'
import {Operation_ApplyRetryFailed as ApplyRetryFailed__1_7_0} from './v1_7_0/Operation.js'

export function convert__operation__apply_retry_failed__from__1_7_0(from: ApplyRetryFailed__1_7_0): api_Operation_ApplyRetryFailed {
    return new api_Operation_ApplyRetryFailed (
        from.targetProfile,
        from.selectionHash,
        from.confirm
    )
}