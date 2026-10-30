import {Result_Mutation as api_Result_Mutation} from './Result.js'
import {convert__mutation_receipt__from__1_7_0} from './from_1_7_0_mutation-receipt.js'
import {Result_Mutation as Mutation__1_7_0} from './v1_7_0/Result.js'

export function convert__result__mutation__from__1_7_0(from: Mutation__1_7_0): api_Result_Mutation {
    return new api_Result_Mutation (
        convert__mutation_receipt__from__1_7_0(from.receipt)
    )
}