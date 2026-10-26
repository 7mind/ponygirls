import {Operation_Receipt as Receipt__1_0_0} from '../v1_0_0/Operation.js'
import {Operation_Receipt as v1_1_0_Operation_Receipt} from './Operation.js'

export function convert__operation__receipt__from__1_0_0(from: Receipt__1_0_0): v1_1_0_Operation_Receipt {
    return new v1_1_0_Operation_Receipt (
        from.mutationId
    )
}