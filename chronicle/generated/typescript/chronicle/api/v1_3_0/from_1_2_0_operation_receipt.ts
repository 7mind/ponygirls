import {Operation_Receipt as Receipt__1_2_0} from '../v1_2_0/Operation.js'
import {Operation_Receipt as v1_3_0_Operation_Receipt} from './Operation.js'

export function convert__operation__receipt__from__1_2_0(from: Receipt__1_2_0): v1_3_0_Operation_Receipt {
    return new v1_3_0_Operation_Receipt (
        from.mutationId
    )
}