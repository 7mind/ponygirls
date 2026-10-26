import {Result_Mutation as Mutation__1_2_0} from '../v1_2_0/Result.js'
import {Result_Mutation as v1_3_0_Result_Mutation} from './Result.js'
import {convert__mutation_receipt__from__1_2_0} from './from_1_2_0_mutation-receipt.js'

export function convert__result__mutation__from__1_2_0(from: Mutation__1_2_0): v1_3_0_Result_Mutation {
    return new v1_3_0_Result_Mutation (
        convert__mutation_receipt__from__1_2_0(from.receipt)
    )
}