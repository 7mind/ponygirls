import {Operation_ApplyOwnerReindex as api_Operation_ApplyOwnerReindex} from './Operation.js'
import {Operation_ApplyOwnerReindex as ApplyOwnerReindex__1_4_0} from './v1_4_0/Operation.js'

export function convert__operation__apply_owner_reindex__from__1_4_0(from: ApplyOwnerReindex__1_4_0): api_Operation_ApplyOwnerReindex {
    return new api_Operation_ApplyOwnerReindex (
        from.targetProfile,
        from.selectionHash,
        from.confirm
    )
}