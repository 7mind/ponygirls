import {MutationReceipt as MutationReceipt__1_4_0} from '../v1_4_0/MutationReceipt.js'
import {MutationReceipt as v1_5_0_MutationReceipt} from './MutationReceipt.js'

export function convert__mutation_receipt__from__1_4_0(from: MutationReceipt__1_4_0): v1_5_0_MutationReceipt {
    return new v1_5_0_MutationReceipt (
        from.requestId,
        from.operation,
        from.entityId
    )
}