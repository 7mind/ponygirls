import {MutationReceipt as MutationReceipt__1_5_0} from '../v1_5_0/MutationReceipt.js'
import {MutationReceipt as v1_6_0_MutationReceipt} from './MutationReceipt.js'

export function convert__mutation_receipt__from__1_5_0(from: MutationReceipt__1_5_0): v1_6_0_MutationReceipt {
    return new v1_6_0_MutationReceipt (
        from.requestId,
        from.operation,
        from.entityId
    )
}