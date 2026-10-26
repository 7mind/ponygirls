import {MutationReceipt as MutationReceipt__1_0_0} from '../v1_0_0/MutationReceipt.js'
import {MutationReceipt as v1_1_0_MutationReceipt} from './MutationReceipt.js'

export function convert__mutation_receipt__from__1_0_0(from: MutationReceipt__1_0_0): v1_1_0_MutationReceipt {
    return new v1_1_0_MutationReceipt (
        from.requestId,
        from.operation,
        from.entityId
    )
}