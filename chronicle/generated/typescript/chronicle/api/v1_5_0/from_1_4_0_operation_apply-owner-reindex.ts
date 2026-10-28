import {Operation_ApplyOwnerReindex as ApplyOwnerReindex__1_4_0} from '../v1_4_0/Operation.js'
import {Operation_ApplyOwnerReindex as v1_5_0_Operation_ApplyOwnerReindex} from './Operation.js'

export function convert__operation__apply_owner_reindex__from__1_4_0(from: ApplyOwnerReindex__1_4_0): v1_5_0_Operation_ApplyOwnerReindex {
    return new v1_5_0_Operation_ApplyOwnerReindex (
        from.targetProfile,
        from.selectionHash,
        from.confirm
    )
}