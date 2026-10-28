import {Operation_ApplyRetryFailed as api_Operation_ApplyRetryFailed} from './Operation.js'
import {Operation_ApplyRetryFailed as ApplyRetryFailed__1_6_0} from './v1_6_0/Operation.js'

export function convert__operation__apply_retry_failed__from__1_6_0(from: ApplyRetryFailed__1_6_0): api_Operation_ApplyRetryFailed {
    return new api_Operation_ApplyRetryFailed (
        from.targetProfile,
        from.selectionHash,
        from.confirm
    )
}