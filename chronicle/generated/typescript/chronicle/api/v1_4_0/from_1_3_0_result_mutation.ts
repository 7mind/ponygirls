import {Result_Mutation as Mutation__1_3_0} from '../v1_3_0/Result.js'
import {Result_Mutation as v1_4_0_Result_Mutation} from './Result.js'
import {convert__mutation_receipt__from__1_3_0} from './from_1_3_0_mutation-receipt.js'

export function convert__result__mutation__from__1_3_0(from: Mutation__1_3_0): v1_4_0_Result_Mutation {
    return new v1_4_0_Result_Mutation (
        convert__mutation_receipt__from__1_3_0(from.receipt)
    )
}