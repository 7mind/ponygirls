import {MutationReceipt as api_MutationReceipt} from './MutationReceipt.js'
import {MutationReceipt as MutationReceipt__1_7_0} from './v1_7_0/MutationReceipt.js'

export function convert__mutation_receipt__from__1_7_0(from: MutationReceipt__1_7_0): api_MutationReceipt {
    return new api_MutationReceipt (
        from.requestId,
        from.operation,
        from.entityId
    )
}